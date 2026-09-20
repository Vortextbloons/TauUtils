import { system, type Player } from "@minecraft/server";
import {
  getPlotForLocation,
  getPlotSlotsList,
  getPlotTitle,
  processQueuedPlotBuildJobs,
  processQueuedPlotSnapshots,
  saveAssignedPlayerPlot,
} from "../plots";
import { getPlayerId, isFeatureEnabled, state } from "../storage";
import { getCachedPlayers } from "./player-cache";

type PlotTitleSample = {
  x: number;
  y: number;
  z: number;
  dimensionId: string;
};

const lastSeenPlotByPlayerId: Record<string, string | undefined> = {};
const lastPlotTitleSampleByPlayerId: Record<string, PlotTitleSample> = {};
let plotAutoSaveJobId: number | undefined;
let plotTitleJobId: number | undefined;
let plotSaveCursor = 0;

/** Called from the player-leave cleanup path. */
export function clearPlotTitleStateForPlayer(playerId: string): void {
  delete lastSeenPlotByPlayerId[playerId];
  delete lastPlotTitleSampleByPlayerId[playerId];
}

function processPlotAutoSaveTick(
  getNextPlayer: () => Player | undefined,
  advanceCursor: () => void,
  perTick: number,
): void {
  if (!isFeatureEnabled("plots")) {
    // Mirror combat pattern: cancel a mid-flight autosave job when disabled.
    if (plotAutoSaveJobId !== undefined) {
      system.clearJob(plotAutoSaveJobId);
      plotAutoSaveJobId = undefined;
    }
    return;
  }
  processQueuedPlotSnapshots();
  if (plotAutoSaveJobId !== undefined) return;
  plotAutoSaveJobId = system.runJob(processPlotAutoSaveJob(getNextPlayer, advanceCursor, perTick));
}

function* processPlotAutoSaveJob(
  getNextPlayer: () => Player | undefined,
  advanceCursor: () => void,
  perTick: number,
): Generator<void, void, void> {
  for (let i = 0; i < perTick; i++) {
    if (!isFeatureEnabled("plots")) break;
    const player = getNextPlayer();
    if (player) saveAssignedPlayerPlot(player);
    advanceCursor();
    yield;
  }
  plotAutoSaveJobId = undefined;
}

function processPlotTitleTick(): void {
  if (!isFeatureEnabled("plots")) {
    // Mirror combat pattern: cancel a mid-flight title job when disabled.
    if (plotTitleJobId !== undefined) {
      system.clearJob(plotTitleJobId);
      plotTitleJobId = undefined;
    }
    return;
  }
  if (!state.plots.config.autoBuild.showEnterTitle) return;
  if (plotTitleJobId !== undefined) return;
  const players = getCachedPlayers().slice();
  if (players.length === 0) return;
  plotTitleJobId = system.runJob(processPlotTitleJob(players));
}

function* processPlotTitleJob(players: Player[]): Generator<void, void, void> {
  if (!isFeatureEnabled("plots") || !state.plots.config.autoBuild.showEnterTitle) {
    plotTitleJobId = undefined;
    return;
  }
  const radius = Math.max(1, state.plots.config.autoBuild.titleRadius);
  const slots = getPlotSlotsList();
  for (const player of players) {
    if (!isFeatureEnabled("plots") || !state.plots.config.autoBuild.showEnterTitle) break;
    if (player.dimension.id !== state.plots.config.dimensionId) {
      yield;
      continue;
    }
    const pid = getPlayerId(player);
    const location = player.location;
    const flooredLocation = {
      x: Math.floor(location.x),
      y: Math.floor(location.y),
      z: Math.floor(location.z),
      dimensionId: player.dimension.id,
    };
    const previousSample = lastPlotTitleSampleByPlayerId[pid];
    if (
      previousSample &&
      previousSample.dimensionId === flooredLocation.dimensionId &&
      previousSample.x === flooredLocation.x &&
      previousSample.y === flooredLocation.y &&
      previousSample.z === flooredLocation.z
    ) {
      yield;
      continue;
    }
    lastPlotTitleSampleByPlayerId[pid] = flooredLocation;

    const expanded = {
      x: location.x,
      y: location.y,
      z: location.z,
    };
    const slot = slots.find((s) =>
      expanded.x >= s.min.x - radius && expanded.x <= s.max.x + radius &&
      expanded.y >= s.min.y - radius && expanded.y <= s.max.y + radius &&
      expanded.z >= s.min.z - radius && expanded.z <= s.max.z + radius
    ) ?? getPlotForLocation(player.location);

    const currentId = slot?.id;
    if (lastSeenPlotByPlayerId[pid] !== currentId) {
      lastSeenPlotByPlayerId[pid] = currentId;
      if (slot) {
        player.onScreenDisplay.setTitle(getPlotTitle(slot), {
          fadeInDuration: 5,
          stayDuration: 25,
          fadeOutDuration: 10,
        });
      }
    }
    yield;
  }
  plotTitleJobId = undefined;
}

/** Task entry for the orchestrator: cursor-budgeted autosave pass, reuses the tick's cached players. */
export function processPlotAutoSaveBackgroundTick(): void {
  if (!isFeatureEnabled("plots")) {
    if (plotAutoSaveJobId !== undefined) {
      system.clearJob(plotAutoSaveJobId);
      plotAutoSaveJobId = undefined;
    }
    return;
  }
  const players = getCachedPlayers();
  if (players.length === 0) {
    processQueuedPlotSnapshots();
    return;
  }
  const perTick = Math.max(1, Math.ceil(players.length / 10));
  processPlotAutoSaveTick(
    () => players[plotSaveCursor % players.length],
    () => { plotSaveCursor++; },
    perTick,
  );
}

/** Task entry for the orchestrator. */
export function processPlotTitleBackgroundTick(): void {
  processPlotTitleTick();
}

/** Task entry for the orchestrator. */
export function processPlotBuildQueueBackgroundTick(): void {
  if (!isFeatureEnabled("plots")) return;
  processQueuedPlotBuildJobs();
}
