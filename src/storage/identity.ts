import { world } from "@minecraft/server";
import { parseJSON, safeSetDynamicJson } from "./dynamic-json";

// ---------------------------------------------------------------------------
// Stable player identity aliases (additive layer only).
// Maps stable playerIds <-> current display names so renames do not fork
// stats or orphan per-player stores. Does NOT change getPlayerId semantics:
// existing name->id keys keep working; this layer only records the alias
// history and resolves names to the same stable id.
// ---------------------------------------------------------------------------

export const IDENTITY_ALIASES_KEY = "tau:identity:aliases";
export const IDENTITY_MAX_PREVIOUS_NAMES = 10;
export const IDENTITY_MAX_RECORDS = 2000;

export type IdentityAliasRecord = {
  playerId: string;
  currentName: string;
  previousNames: string[];
  updatedAt: number;
};

export type IdentityAliasStore = {
  aliases: Record<string, IdentityAliasRecord>;
  nameToId: Record<string, string>;
};

function emptyIdentityStore(): IdentityAliasStore {
  return { aliases: {}, nameToId: {} };
}

function normalizeName(name: string): string {
  return String(name ?? "").trim().toLowerCase();
}

let identityCache: IdentityAliasStore | undefined;

function sanitizeLoaded(store: IdentityAliasStore): IdentityAliasStore {
  if (typeof store !== "object" || store === null) return emptyIdentityStore();
  const out = emptyIdentityStore();
  for (const [playerId, record] of Object.entries(store.aliases ?? {})) {
    if (typeof playerId !== "string" || playerId.length === 0) continue;
    if (typeof record !== "object" || record === null) continue;
    const currentName = typeof record.currentName === "string" ? record.currentName : "";
    if (!currentName) continue;
    const previousNames = Array.isArray(record.previousNames)
      ? record.previousNames.filter((n): n is string => typeof n === "string").slice(0, IDENTITY_MAX_PREVIOUS_NAMES)
      : [];
    out.aliases[playerId] = {
      playerId,
      currentName,
      previousNames,
      updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
    };
    out.nameToId[normalizeName(currentName)] = playerId;
  }
  for (const [name, playerId] of Object.entries(store.nameToId ?? {})) {
    if (typeof name === "string" && typeof playerId === "string" && out.aliases[playerId]) {
      out.nameToId[name] = playerId;
    }
  }
  return out;
}

export function loadIdentityAliases(): IdentityAliasStore {
  try {
    const raw = world.getDynamicProperty(IDENTITY_ALIASES_KEY) as string | undefined;
    const parsed = parseJSON<IdentityAliasStore>(raw ?? "", emptyIdentityStore());
    identityCache = sanitizeLoaded(parsed);
  } catch {
    identityCache = emptyIdentityStore();
  }
  return identityCache;
}

function getIdentityCache(): IdentityAliasStore {
  if (!identityCache) return loadIdentityAliases();
  return identityCache;
}

function persistIdentityAliases(): boolean {
  try {
    return safeSetDynamicJson(IDENTITY_ALIASES_KEY, identityCache ?? emptyIdentityStore());
  } catch {
    return false;
  }
}

// Record (or refresh) the current display name for a stable playerId.
// Updates the alias history on rename without creating a new id.
export function recordPlayerIdentity(playerId: string, currentName: string): boolean {
  try {
    const id = String(playerId ?? "").trim();
    const name = String(currentName ?? "").trim();
    if (!id || !name) return false;
    const cache = getIdentityCache();
    const existing = cache.aliases[id];
    if (existing && existing.currentName === name) return true;
    const previousNames = existing
      ? [existing.currentName, ...existing.previousNames].filter((n) => n !== name).slice(0, IDENTITY_MAX_PREVIOUS_NAMES)
      : [];
    cache.aliases[id] = { playerId: id, currentName: name, previousNames, updatedAt: Date.now() };
    if (existing) delete cache.nameToId[normalizeName(existing.currentName)];
    cache.nameToId[normalizeName(name)] = id;
    // Soft cap: evict the least-recently-updated records past the limit.
    const ids = Object.keys(cache.aliases);
    if (ids.length > IDENTITY_MAX_RECORDS) {
      const byAge = ids
        .map((key) => cache.aliases[key])
        .sort((a, b) => a.updatedAt - b.updatedAt);
      for (let i = 0; i < ids.length - IDENTITY_MAX_RECORDS; i++) {
        const evicted = byAge[i];
        if (!evicted) continue;
        delete cache.aliases[evicted.playerId];
        if (cache.nameToId[normalizeName(evicted.currentName)] === evicted.playerId) {
          delete cache.nameToId[normalizeName(evicted.currentName)];
        }
      }
    }
    return persistIdentityAliases();
  } catch {
    return false;
  }
}

export function resolvePlayerIdByName(name: string): string | undefined {
  try {
    const id = getIdentityCache().nameToId[normalizeName(name)];
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export function getCurrentNameForId(playerId: string): string | undefined {
  try {
    const record = getIdentityCache().aliases[String(playerId ?? "")];
    return record?.currentName;
  } catch {
    return undefined;
  }
}

export function handlePlayerRename(playerId: string, newName: string): { renamed: boolean; previousName: string | undefined } {
  try {
    const cache = getIdentityCache();
    const existing = cache.aliases[String(playerId ?? "")];
    const previousName = existing?.currentName;
    if (existing && previousName === String(newName ?? "").trim()) {
      return { renamed: false, previousName };
    }
    const ok = recordPlayerIdentity(playerId, newName);
    return { renamed: ok && previousName !== undefined && previousName !== String(newName ?? "").trim(), previousName };
  } catch {
    return { renamed: false, previousName: undefined };
  }
}

// Drop alias records whose playerId is not in the known set (e.g. after a
// stats prune). Returns the number of records removed.
export function pruneOrphanIdentities(knownPlayerIds: Set<string> | string[]): number {
  try {
    const known = Array.isArray(knownPlayerIds) ? new Set(knownPlayerIds) : knownPlayerIds;
    const cache = getIdentityCache();
    let removed = 0;
    for (const playerId of Object.keys(cache.aliases)) {
      if (known.has(playerId)) continue;
      const record = cache.aliases[playerId];
      delete cache.aliases[playerId];
      if (record && cache.nameToId[normalizeName(record.currentName)] === playerId) {
        delete cache.nameToId[normalizeName(record.currentName)];
      }
      removed++;
    }
    if (removed > 0) persistIdentityAliases();
    return removed;
  } catch {
    return 0;
  }
}
