import { system, world, type Player } from "@minecraft/server";
import { clearCrateRuntimeForPlayer } from "../crates";
import { clearCustomAreaRuntimeForPlayer } from "../custom-areas";
import { clearRtpRuntimeForPlayer } from "../rtp";
import { handleCombatJoin, handleCombatLeave } from "../combat";
import { flushPendingReferralRewards } from "../referrals";
import {
  ensurePlayerPlotAssigned,
  getAssignedSlotIdForOwner,
  getPlotForLocation,
  getPlotOwnerIdForPlayer,
  reconcileAllPlotState,
  releasePlayerPlotById,
  showPlotError,
  teleportPlayerToSlot,
} from "../plots";
import { clearSocialRuntimeForPlayer } from "../social";
import { clearWarpRuntimeForPlayer } from "../warps";
import { clearSidebarRuntimeForPlayer } from "../sidebar";
import { clearCustomAreaUiRuntimeForPlayer } from "../ui";
import {
  asPlayer,
  collectCurrencyObjectives,
  ensureScoreboardObjective,
  getPlayerId,
  incrementStat,
  isFeatureEnabled,
  saveModeration,
  state,
  tell,
} from "../storage";
import { clearBannedInventory } from "../moderation/banned-items";
import { cacheModerationInspectionSnapshot } from "./moderation-events";
import { clearGeneratorMenuForPlayer } from "./interaction-events";
import { clearPlotTitleStateForPlayer } from "./plot-events";
import { getCachedPlayers } from "./player-cache";

const pendingJoinInitializationByName = new Set<string>();

type DistanceSample = {
  x: number;
  y: number;
  z: number;
};

const lastSampleByPlayerId: Record<string, DistanceSample> = {};
let statsSampleJobId: number | undefined;

function ensurePlayerCurrencyScoreboards(player: Player): void {
  system.runTimeout(() => {
    if (!player.isValid) return;
    runPlayerCurrencyInit(player);
  }, 1);
}

function runPlayerCurrencyInit(player: Player): void {
  try {
    const objectives = collectCurrencyObjectives();
    if (objectives.length === 0) return;
    for (const objectiveId of objectives) {
      const created = ensureScoreboardObjective(objectiveId);
      if (!created) {
        tell(player, `§c[tau-debug] failed to ensure objective "${objectiveId}"`);
        continue;
      }
      try {
        player.runCommand(`scoreboard players add @s ${objectiveId} 0`);
      } catch (e) {
        tell(player, `§c[tau-debug] failed to set row for "${objectiveId}": ${String(e)}`);
      }
    }
  } catch (e) {
    tell(player, `§c[tau-debug] currency init crashed: ${String(e)}`);
  }
}

function initializePlayerJoinState(player: ReturnType<typeof asPlayer>): void {
  if (!player) return;
  const id = getPlayerId(player);
  lastSampleByPlayerId[id] = { x: player.location.x, y: player.location.y, z: player.location.z };

  ensurePlayerCurrencyScoreboards(player);

  if (isFeatureEnabled("moderation")) {
    clearBannedInventory(player);
    if (cacheModerationInspectionSnapshot(player)) saveModeration();
  }
  if (isFeatureEnabled("combat")) handleCombatJoin(player);
  if (isFeatureEnabled("referrals")) flushPendingReferralRewards(player);

  if (!isFeatureEnabled("plots")) return;

  reconcileAllPlotState("player_join_init");
  const ensured = ensurePlayerPlotAssigned(player);
  if (!ensured.ok) showPlotError(player, ensured.message);

  const ownerId = getPlotOwnerIdForPlayer(player);
  const spawnedInSlot = getPlotForLocation(player.location);
  if (ownerId && spawnedInSlot) {
    const assignedSlotId = getAssignedSlotIdForOwner(ownerId);
    if (assignedSlotId && assignedSlotId !== spawnedInSlot.id) {
      const moved = teleportPlayerToSlot(player, assignedSlotId);
      if (!moved.ok) showPlotError(player, moved.message);
    }
  }
}

export function initializeOnlinePlayersAfterReload(): void {
  for (const player of getCachedPlayers()) {
    initializePlayerJoinState(player);
  }
}

function schedulePlayerJoinInitialization(playerName: string): void {
  schedulePlayerJoinInitializationRetry(playerName, 0);
}

function schedulePlayerJoinInitializationRetry(playerName: string, attempt: number): void {
  if (attempt === 0) {
    if (pendingJoinInitializationByName.has(playerName)) return;
    pendingJoinInitializationByName.add(playerName);
    const immediate = getCachedPlayers().find((entry) => entry.name === playerName);
    if (immediate) {
      system.run(() => {
        pendingJoinInitializationByName.delete(playerName);
        if (!immediate.isValid) return;
        initializePlayerJoinState(immediate);
      });
      return;
    }
  }
  system.runTimeout(() => {
    const player = getCachedPlayers().find((entry) => entry.name === playerName);
    if (player) {
      pendingJoinInitializationByName.delete(playerName);
      if (!player.isValid) return;
      initializePlayerJoinState(player);
      return;
    }
    if (attempt >= 10) {
      pendingJoinInitializationByName.delete(playerName);
      return;
    }
    schedulePlayerJoinInitializationRetry(playerName, attempt + 1);
  }, 1);
}

function processStatsSample(): void {
  if (!isFeatureEnabled("stats")) {
    // Mirror combat pattern: cancel a mid-flight sample job when disabled.
    if (statsSampleJobId !== undefined) {
      system.clearJob(statsSampleJobId);
      statsSampleJobId = undefined;
    }
    return;
  }
  if (statsSampleJobId !== undefined) return;
  const players = getCachedPlayers().slice();
  if (players.length === 0) return;
  statsSampleJobId = system.runJob(processStatsSampleJob(players));
}

function* processStatsSampleJob(players: Player[]): Generator<void, void, void> {
  for (const player of players) {
    if (!isFeatureEnabled("stats")) break;
    const id = getPlayerId(player);
    const prev = lastSampleByPlayerId[id];
    const location = player.location;
    if (prev) {
      const dx = location.x - prev.x;
      const dy = location.y - prev.y;
      const dz = location.z - prev.z;
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 0) incrementStat(player, "distanceTraveled", dist);
      }
    }
    lastSampleByPlayerId[id] = { x: location.x, y: location.y, z: location.z };
    incrementStat(player, "timePlayed", 1);
    yield;
  }
  statsSampleJobId = undefined;
}

/** Task entry for the orchestrator. */
export function processStatsSampleBackgroundTick(): void {
  processStatsSample();
}

export function registerPlayerLifecycleEvents(): void {
  world.afterEvents.playerJoin.subscribe((event) => {
    const player = getCachedPlayers().find((entry) => entry.name === event.playerName);
    if (!player) {
      schedulePlayerJoinInitialization(event.playerName);
      return;
    }
    schedulePlayerJoinInitialization(player.name);
  });

  world.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn) return;
    schedulePlayerJoinInitialization(event.player.name);
  });

  world.beforeEvents.playerLeave.subscribe((event) => {
    if (!isFeatureEnabled("combat")) return;
    handleCombatLeave(event.player);
  });

  world.afterEvents.playerLeave.subscribe((event) => {
    pendingJoinInitializationByName.delete(event.playerName);
    const playerId = (event as { playerId?: string }).playerId ?? state.stats.playerIds[event.playerName];
    if (playerId) {
      clearCrateRuntimeForPlayer(playerId);
      clearCustomAreaRuntimeForPlayer(playerId);
      clearCustomAreaUiRuntimeForPlayer(playerId);
      clearGeneratorMenuForPlayer(playerId);
      clearRtpRuntimeForPlayer(playerId);
      clearSocialRuntimeForPlayer(playerId);
      clearWarpRuntimeForPlayer(playerId);
      clearSidebarRuntimeForPlayer(playerId);
      delete lastSampleByPlayerId[playerId];
      clearPlotTitleStateForPlayer(playerId);
    }

    if (!isFeatureEnabled("plots")) return;
    if (playerId) {
      const team = Object.values(state.teams.teams).find((entry) => entry.ownerPlayerId === playerId || entry.memberPlayerIds.includes(playerId));
      if (team && team.teamPlotEnabled) {
        const anyTeamPlayerOnline = world.getAllPlayers().some((online) => {
          const onlineId = getPlayerId(online);
          return onlineId === team.ownerPlayerId || team.memberPlayerIds.includes(onlineId);
        });
        if (anyTeamPlayerOnline) return;
        releasePlayerPlotById(team.ownerPlayerId);
        return;
      }
    }
    if (playerId) releasePlayerPlotById(playerId);
    reconcileAllPlotState("player_leave");
  });
}
