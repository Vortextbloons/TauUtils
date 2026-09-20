import { world } from "@minecraft/server";
import { STORAGE_KEYS, type ClaimStore } from "../../types";
import { defaultClaimStore } from "../defaults";
import { CLAIMS_CLAIM_PREFIX, CLAIMS_CONFIG_KEY, CLAIMS_MIGRATION_MARKER_KEY, parseJSON, quarantineCorruptDynamicValue, setDynamicJsonIfChanged } from "../dynamic-json";

let persistedClaimKeys = new Set<string>();
const persisted = new Map<string, string>();

export function loadClaimsFromSplitKeys(dynamicPropertyIds: string[]): { store: ClaimStore; hasSplitData: boolean } {
  const defaults = defaultClaimStore();
  const configRaw = world.getDynamicProperty(CLAIMS_CONFIG_KEY) as string | undefined;
  const claimKeys = dynamicPropertyIds.filter((key) => key.startsWith(CLAIMS_CLAIM_PREFIX));
  if (!configRaw && claimKeys.length === 0) return { store: defaults, hasSplitData: false };

  const store: ClaimStore = {
    ...defaults,
    config: parseJSON(configRaw, defaults.config),
    claims: {},
    playerClaimIds: {},
    teamClaimIds: {},
  };

  persisted.clear();
  if (configRaw) persisted.set(CLAIMS_CONFIG_KEY, configRaw);
  persistedClaimKeys = new Set(claimKeys);

  for (const key of claimKeys) {
    const raw = world.getDynamicProperty(key) as string | undefined;
    if (!raw) continue;
    const claim = parseJSON(raw, undefined as unknown as ClaimStore["claims"][string] | undefined);
    if (!claim?.id) continue;
    store.claims[claim.id] = claim;
    persisted.set(key, raw);
    store.playerClaimIds[claim.ownerPlayerId] ??= [];
    store.playerClaimIds[claim.ownerPlayerId].push(claim.id);
    if (claim.teamId) {
      store.teamClaimIds[claim.teamId] ??= [];
      store.teamClaimIds[claim.teamId].push(claim.id);
    }
  }

  return { store, hasSplitData: true };
}

export function writeClaimsToSplitKeys(store: ClaimStore): boolean {
  const nextKeys = new Set<string>();
  setDynamicJsonIfChanged(CLAIMS_CONFIG_KEY, store.config, persisted);
  for (const claim of Object.values(store.claims)) {
    const key = `${CLAIMS_CLAIM_PREFIX}${claim.id}`;
    nextKeys.add(key);
    if (!setDynamicJsonIfChanged(key, claim, persisted)) return false;
  }
  for (const oldKey of persistedClaimKeys) {
    if (!nextKeys.has(oldKey)) {
      world.setDynamicProperty(oldKey, undefined);
      persisted.delete(oldKey);
    }
  }
  persistedClaimKeys = nextKeys;
  return true;
}

// One-shot legacy migration: merge the single-blob tau:claims backup into
// split keys, then clear it only after the split write verifies. Reuses the
// caller-passed id list so no extra world.getDynamicPropertyIds() scan runs.
export function migrateLegacyClaimsToSplitOneShot(dynamicPropertyIds: string[]): {
  migrated: boolean;
  failed: boolean;
  store?: ClaimStore;
} {
  const marker = world.getDynamicProperty(CLAIMS_MIGRATION_MARKER_KEY);
  if (marker === true || marker === 1 || marker === "1") return { migrated: false, failed: false };

  const legacyRaw = world.getDynamicProperty(STORAGE_KEYS.claims) as string | undefined;
  if (!legacyRaw) {
    world.setDynamicProperty(CLAIMS_MIGRATION_MARKER_KEY, true);
    return { migrated: false, failed: false };
  }

  const legacyParsed = parseJSON<Partial<ClaimStore> | undefined>(legacyRaw, undefined);
  if (!legacyParsed || typeof legacyParsed !== "object") {
    quarantineCorruptDynamicValue(STORAGE_KEYS.claims, legacyRaw);
    world.setDynamicProperty(STORAGE_KEYS.claims, undefined);
    world.setDynamicProperty(CLAIMS_MIGRATION_MARKER_KEY, true);
    return { migrated: false, failed: false };
  }

  const split = loadClaimsFromSplitKeys(dynamicPropertyIds);
  const defaults = defaultClaimStore();
  const merged: ClaimStore = {
    config: {
      ...defaults.config,
      ...(legacyParsed.config ?? {}),
      ...(split.hasSplitData ? split.store.config : {}),
      defaultFlags: {
        ...defaults.config.defaultFlags,
        ...(legacyParsed.config?.defaultFlags ?? {}),
        ...(split.hasSplitData ? split.store.config.defaultFlags : {}),
      },
    },
    claims: { ...(legacyParsed.claims ?? {}), ...(split.hasSplitData ? split.store.claims : {}) },
    playerClaimIds: {},
    teamClaimIds: {},
  };
  for (const [claimId, claim] of Object.entries(merged.claims)) {
    if (!claim || !claim.id || !claim.ownerPlayerId) {
      delete merged.claims[claimId];
      continue;
    }
    merged.playerClaimIds[claim.ownerPlayerId] ??= [];
    merged.playerClaimIds[claim.ownerPlayerId].push(claim.id);
    if (claim.teamId) {
      merged.teamClaimIds[claim.teamId] ??= [];
      merged.teamClaimIds[claim.teamId].push(claim.id);
    }
  }

  if (!writeClaimsToSplitKeys(merged)) {
    console.warn("[TauUtils] Claims migration failed; keeping legacy tau:claims key for safety.");
    return { migrated: false, failed: true };
  }

  world.setDynamicProperty(STORAGE_KEYS.claims, undefined);
  world.setDynamicProperty(CLAIMS_MIGRATION_MARKER_KEY, true);
  return { migrated: true, failed: false, store: merged };
}
