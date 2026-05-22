import { system, world } from "@minecraft/server";
import { safeSetDynamicJson, STATS_PLAYER_IDS_KEY, STATS_PLAYER_PREFIX, parseJSON } from "../dynamic-json";
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

  const playerIdsRaw = world.getDynamicProperty(STATS_PLAYER_IDS_KEY) as string | undefined;
  if (playerIdsRaw) {
    stats.playerIds = parseJSON<Record<string, string>>(playerIdsRaw, {});
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

function* flushStatsJob(): Generator<void, void, void> {
  if (dirtyStatsPlayerIds.size > 0) {
    safeSetDynamicJson(STATS_PLAYER_IDS_KEY, state.stats.playerIds);
    dirtyStatsPlayerIds.clear();
    yield;
  }
  if (dirtyStatsPlayers.size > 0) {
    const playerIds = [...dirtyStatsPlayers];
    dirtyStatsPlayers.clear();
    for (const playerId of playerIds) {
      const stats = state.stats.players[playerId];
      if (!stats) continue;
      safeSetDynamicJson(`${STATS_PLAYER_PREFIX}${playerId}`, stats);
      yield;
    }
  }
  world.setDynamicProperty("tau:stats", undefined);
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
