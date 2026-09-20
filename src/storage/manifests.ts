import { world } from "@minecraft/server";
import {
  parseJSON,
  quarantineCorruptDynamicValue,
  safeSetDynamicJson,
} from "./dynamic-json";

// ---------------------------------------------------------------------------
// Generation + checksum manifests for split-key stores.
// Each manifest is a tiny single-blob key ("tau:manifest:<store>") written
// alongside split keys on a verified flush and checked on load. A mismatch
// only warns + quarantines the manifest copy — split data is never deleted.
// Missing manifests are treated as ok (backward compatible with old saves).
// ---------------------------------------------------------------------------

export type SplitStoreName =
  | "stats"
  | "plots"
  | "player-shops"
  | "claims"
  | "custom-areas"
  | "loot-chests"
  | "tpa";

export const SPLIT_MANIFEST_STORES: readonly SplitStoreName[] = [
  "stats",
  "plots",
  "player-shops",
  "claims",
  "custom-areas",
  "loot-chests",
  "tpa",
];

export type StoreManifest = {
  store: SplitStoreName;
  generation: number;
  entryCount: number;
  checksum: number;
  updatedAt: number;
};

export type ManifestVerifyResult = {
  ok: boolean;
  reason: string;
};

export type ManifestBatchResult = {
  ok: boolean;
  issues: string[];
};

export function manifestKeyFor(store: SplitStoreName): string {
  return `tau:manifest:${store}`;
}

// FNV-1a 32-bit over sorted entry keys. Cheap and order-independent.
export function computeEntryChecksum(entryKeys: string[]): number {
  const sorted = [...entryKeys].sort();
  let hash = 0x811c9dc5;
  for (const key of sorted) {
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 10; // line-feed separator between keys
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function readStoreManifest(store: SplitStoreName): StoreManifest | undefined {
  try {
    const raw = world.getDynamicProperty(manifestKeyFor(store)) as string | undefined;
    if (!raw) return undefined;
    const parsed = parseJSON<StoreManifest | undefined>(raw, undefined);
    if (!parsed || parsed.store !== store) return undefined;
    if (!Number.isFinite(parsed.generation) || !Number.isFinite(parsed.entryCount) || !Number.isFinite(parsed.checksum)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeStoreManifest(store: SplitStoreName, entryCount: number, checksum: number): boolean {
  try {
    const previous = readStoreManifest(store);
    const generation = previous !== undefined && Number.isFinite(previous.generation)
      ? previous.generation + 1
      : 1;
    const manifest: StoreManifest = {
      store,
      generation,
      entryCount,
      checksum,
      updatedAt: Date.now(),
    };
    return safeSetDynamicJson(manifestKeyFor(store), manifest);
  } catch {
    return false;
  }
}

// Write (or refresh) the manifest after a verified split flush. Skips the
// write entirely when count + checksum already match, so no-op flushes do
// not churn the generation counter.
export function updateManifestAfterSplitWrite(store: SplitStoreName, entryKeys: string[]): boolean {
  try {
    const checksum = computeEntryChecksum(entryKeys);
    const previous = readStoreManifest(store);
    if (previous !== undefined && previous.entryCount === entryKeys.length && previous.checksum === checksum) {
      return true;
    }
    return writeStoreManifest(store, entryKeys.length, checksum);
  } catch {
    return false;
  }
}

export function verifyStoreManifest(store: SplitStoreName, entryKeys: string[]): ManifestVerifyResult {
  try {
    const raw = world.getDynamicProperty(manifestKeyFor(store)) as string | undefined;
    if (!raw) return { ok: true, reason: "missing" };
    const manifest = parseJSON<StoreManifest | undefined>(raw, undefined);
    if (!manifest || manifest.store !== store) {
      quarantineCorruptDynamicValue(manifestKeyFor(store), String(raw ?? ""));
      console.warn(`[TauUtils] Store manifest for ${store} is unreadable; quarantined manifest copy, split data untouched.`);
      return { ok: false, reason: `${store}:unreadable` };
    }
    const checksum = computeEntryChecksum(entryKeys);
    if (manifest.entryCount !== entryKeys.length || manifest.checksum !== checksum) {
      quarantineCorruptDynamicValue(manifestKeyFor(store), raw);
      console.warn(
        `[TauUtils] Store manifest mismatch for ${store} (expected ${manifest.entryCount} entries/checksum ${manifest.checksum}, found ${entryKeys.length}/${checksum}); quarantined manifest copy, split data untouched.`
      );
      return { ok: false, reason: `${store}:mismatch` };
    }
    return { ok: true, reason: "match" };
  } catch {
    return { ok: false, reason: `${store}:error` };
  }
}

// Batch-verify every split store from caller-supplied entry key lists. The
// caller filters an already-fetched dynamic-property id list, so this adds
// no new world scans.
export function verifySplitManifests(entriesByStore: Record<SplitStoreName, string[]>): ManifestBatchResult {
  const issues: string[] = [];
  for (const store of SPLIT_MANIFEST_STORES) {
    const result = verifyStoreManifest(store, entriesByStore[store] ?? []);
    if (!result.ok) issues.push(result.reason);
  }
  return { ok: issues.length === 0, issues };
}
