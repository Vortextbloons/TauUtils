import { system, world } from "@minecraft/server";
import { readDynamicJSON, writeDynamicJSON, safeSetDynamicJson, STATS_PLAYER_IDS_KEY, STATS_PLAYER_PREFIX, parseJSON } from "../dynamic-json";
import { updateManifestAfterSplitWrite } from "../manifests";
import { type PlayerStats, type StatsStore } from "../../types";
import { defaultPlayerStats } from "../defaults";
import { state } from "../state";

// ---------------------------------------------------------------------------
// Dirty stats tracking
// ---------------------------------------------------------------------------

const dirtyStatsPlayerIds = new Set<string>();
const dirtyStatsPlayers = new Set<string>();
let statsFlushScheduled = false;
let statsFlushJobId: number | undefined;

export function loadStatsFromSplitKeys(dynamicPropertyIds: string[]): { store: StatsStore; hasSplitData: boolean } {
  const stats: StatsStore = { playerIds: {}, players: {} };
  let hasSplitData = false;

  const playerIds = readDynamicJSON<Record<string, string> | undefined>(STATS_PLAYER_IDS_KEY, undefined);
  if (playerIds) {
    stats.playerIds = playerIds;
    hasSplitData = true;
  }

  for (const key of dynamicPropertyIds) {
    if (!key.startsWith(STATS_PLAYER_PREFIX)) continue;
    const playerId = key.slice(STATS_PLAYER_PREFIX.length);
    if (!playerId) continue;
    const raw = world.getDynamicProperty(key) as string | undefined;
    const parsed = parseJSON<PlayerStats | undefined>(raw, undefined);
    if (!parsed) continue;
    stats.players[playerId] = parsed;
    hasSplitData = true;
  }

  return { store: stats, hasSplitData };
}

function statsManifestKeys(): string[] {
  const keys = [STATS_PLAYER_IDS_KEY];
  for (const playerId of Object.keys(state.stats.players)) {
    keys.push(`${STATS_PLAYER_PREFIX}${playerId}`);
  }
  return keys;
}

function* flushStatsJob(): Generator<void, void, void> {
  let ok = true;
  if (dirtyStatsPlayerIds.size > 0) {
    const wroteIds = writeDynamicJSON(STATS_PLAYER_IDS_KEY, state.stats.playerIds);
    ok = wroteIds && ok;
    if (wroteIds) dirtyStatsPlayerIds.clear();
    yield;
  }
  if (dirtyStatsPlayers.size > 0) {
    const playerIds = [...dirtyStatsPlayers];
    dirtyStatsPlayers.clear();
    for (const playerId of playerIds) {
      const stats = state.stats.players[playerId];
      if (!stats) continue;
      const wrotePlayer = safeSetDynamicJson(`${STATS_PLAYER_PREFIX}${playerId}`, stats);
      ok = wrotePlayer && ok;
      if (!wrotePlayer) dirtyStatsPlayers.add(playerId);
      yield;
    }
  }
  // Only drop the legacy single-blob backup once every split write succeeded.
  if (ok && dirtyStatsPlayerIds.size === 0 && dirtyStatsPlayers.size === 0) {
    if (updateManifestAfterSplitWrite("stats", statsManifestKeys())) world.setDynamicProperty("tau:stats", undefined);
  } else console.warn("[TauUtils] Stats split write partially failed; keeping legacy tau:stats key for safety.");
  statsFlushJobId = undefined;
  if (dirtyStatsPlayerIds.size > 0 || dirtyStatsPlayers.size > 0) scheduleStatsFlush();
}

function scheduleStatsFlush(): void {
  if (statsFlushScheduled) return;
  statsFlushScheduled = true;
  system.runTimeout(() => {
    statsFlushScheduled = false;
    if (statsFlushJobId !== undefined) return;
    statsFlushJobId = system.runJob(flushStatsJob());
  }, 20);
}

export function markStatsPlayerDirty(playerId: string): void {
  dirtyStatsPlayers.add(playerId);
  scheduleStatsFlush();
}

export function markStatsPlayerIdsDirty(): void {
  dirtyStatsPlayerIds.add("playerIds");
  scheduleStatsFlush();
}

// Flush only what is already dirty. Cheap no-op when nothing changed.
export function requestStatsFlush(): void {
  if (dirtyStatsPlayerIds.size === 0 && dirtyStatsPlayers.size === 0) return;
  scheduleStatsFlush();
}

// Admin path: force a full resync of every in-memory player (e.g. after prune).
export function markAllStatsPlayersDirty(): void {
  markStatsPlayerIdsDirty();
  for (const playerId of Object.keys(state.stats.players)) {
    dirtyStatsPlayers.add(playerId);
  }
  scheduleStatsFlush();
}

// Synchronous drain of the stats dirty sets for shutdown/prune paths.
// Same verified-write semantics as the job version, without yielding.
export function flushStatsDirtySync(): boolean {
  let ok = true;
  let didWork = false;
  try {
    if (dirtyStatsPlayerIds.size > 0) {
      didWork = true;
      const wroteIds = writeDynamicJSON(STATS_PLAYER_IDS_KEY, state.stats.playerIds);
      ok = wroteIds && ok;
      if (wroteIds) dirtyStatsPlayerIds.clear();
    }
    if (dirtyStatsPlayers.size > 0) {
      didWork = true;
      const playerIds = [...dirtyStatsPlayers];
      dirtyStatsPlayers.clear();
      for (const playerId of playerIds) {
        const stats = state.stats.players[playerId];
        if (!stats) continue;
        const wrotePlayer = safeSetDynamicJson(`${STATS_PLAYER_PREFIX}${playerId}`, stats);
        ok = wrotePlayer && ok;
        if (!wrotePlayer) dirtyStatsPlayers.add(playerId);
      }
    }
    if (!didWork) return true;
    if (ok) {
      if (updateManifestAfterSplitWrite("stats", statsManifestKeys())) world.setDynamicProperty("tau:stats", undefined);
    } else {
      console.warn("[TauUtils] Stats sync flush partially failed; keeping legacy tau:stats key for safety.");
    }
  } catch {
    return false;
  }
  return ok;
}

export function resetStatsRuntime(): void {
  if (statsFlushJobId !== undefined) system.clearJob(statsFlushJobId);
  statsFlushJobId = undefined;
  dirtyStatsPlayerIds.clear();
  dirtyStatsPlayers.clear();
}
