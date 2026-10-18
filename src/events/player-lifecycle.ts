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
import { enforcePcAccess } from "../moderation/pc-access";
import { clearBannedInventory } from "../moderation/banned-items";
import { cacheModerationInspectionSnapshot } from "./moderation-events";
import { clearGeneratorMenuForPlayer } from "./interaction-events";
import { clearPlotTitleStateForPlayer } from "./plot-events";
import { getCachedPlayers } from "./player-cache";

const pendingJoinInitializationByName = new Map<string, object>();
const initializedJoinPlayersByName = new Map<string, Player>();
const pendingPlotAssignments = new Map<string, { player: Player; jobId: number }>();

function ensureJoinPlot(player: Player): void {
  const id = getPlayerId(player);
  const pending = pendingPlotAssignments.get(id);
  if (pending) system.clearRun(pending.jobId);
  pendingPlotAssignments.delete(id);
  if (!player.isValid || !isFeatureEnabled("plots") || !state.plots.config.enabled) return;
  const result = ensurePlayerPlotAssigned(player);
  if (result.ok) return;
  // Keep capacity/unavailable assignments pending without rerunning combat or rewards.
  if (!pending) showPlotError(player, `${result.message} Assignment will retry automatically.`);
  const jobId = system.runTimeout(() => {
    if (pendingPlotAssignments.get(id)?.player !== player) return;
    ensureJoinPlot(player);
  }, 100);
  pendingPlotAssignments.set(id, { player, jobId });
}

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
  if (!player?.isValid) return;
  if (enforcePcAccess(player)) return;
  const id = getPlayerId(player);
  lastSampleByPlayerId[id] = { x: player.location.x, y: player.location.y, z: player.location.z };

  ensurePlayerCurrencyScoreboards(player);
  // Plot allocation must not depend on unrelated join handlers succeeding.
  ensureJoinPlot(player);

  if (isFeatureEnabled("moderation")) {
    clearBannedInventory(player);
    if (cacheModerationInspectionSnapshot(player)) saveModeration();
  }
  if (isFeatureEnabled("combat")) handleCombatJoin(player);
  if (isFeatureEnabled("referrals")) flushPendingReferralRewards(player);

  if (!isFeatureEnabled("plots")) return;

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
  if (initializedJoinPlayersByName.get(playerName)?.isValid) return;
  if (pendingJoinInitializationByName.has(playerName)) return;
  const token = {};
  pendingJoinInitializationByName.set(playerName, token);
  schedulePlayerJoinInitializationRetry(playerName, 0, token);
}

function schedulePlayerJoinInitializationRetry(playerName: string, attempt: number, token: object): void {
  if (attempt === 0) {
    const immediate = getCachedPlayers().find((entry) => entry.name === playerName);
    if (immediate) {
      system.run(() => {
        if (pendingJoinInitializationByName.get(playerName) !== token) return;
        pendingJoinInitializationByName.delete(playerName);
        if (!immediate.isValid) return;
        initializedJoinPlayersByName.set(playerName, immediate);
        initializePlayerJoinState(immediate);
      });
      return;
    }
  }
  system.runTimeout(() => {
    if (pendingJoinInitializationByName.get(playerName) !== token) return;
    const player = getCachedPlayers().find((entry) => entry.name === playerName);
    if (player) {
      pendingJoinInitializationByName.delete(playerName);
      if (!player.isValid) return;
      initializedJoinPlayersByName.set(playerName, player);
      initializePlayerJoinState(player);
      return;
    }
    if (attempt >= 10) {
      pendingJoinInitializationByName.delete(playerName);
      return;
    }
    schedulePlayerJoinInitializationRetry(playerName, attempt + 1, token);
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
    initializedJoinPlayersByName.delete(event.playerName);
    const playerId = state.stats.playerIds[event.playerName] ?? (event as { playerId?: string }).playerId;
    if (playerId) {
      const pendingPlot = pendingPlotAssignments.get(playerId);
      if (pendingPlot) system.clearRun(pendingPlot.jobId);
      pendingPlotAssignments.delete(playerId);
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
  });
}
