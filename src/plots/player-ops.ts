import { Player, Vector3, world } from "@minecraft/server";
import { type PlotSlot } from "../types";
import { getPlayerId, savePlots, saveGenerators, state, tell } from "../storage";
import { getPlotSlots, getDimension } from "./grid";
import { clearSlot, saveAndClearSlot, captureSlotGenerators, saveSlotSnapshot, loadSlotSnapshot, applyAutoBuildRoof, getPlotForLocation } from "./build";
import { getPlotOwnerIdForPlayerId, resolveAuthoritativeOwnedSlotId } from "./ownership";
import { getPlayerTeam } from "../teams";

type PlotTitleCacheEntry = {
  key: string;
  title: string;
};

const plotTitleCache = new Map<string, PlotTitleCacheEntry>();

function plotTitleCacheKey(slot: PlotSlot): string {
  const teamVersion = Object.values(state.teams.teams)
    .map((team) => `${team.ownerPlayerId}:${team.teamPlotEnabled ? 1 : 0}:${team.name}`)
    .join("|");
  return `${state.plots.config.autoBuild.titleMode}:${slot.id}:${slot.occupiedByPlayerId ?? ""}:${teamVersion}:${Object.keys(state.stats.playerIds).length}`;
}

function buildPlotTitle(slot: PlotSlot): string {
  const auto = state.plots.config.autoBuild;
  if (auto.titleMode === "plot") return `Plot ${slot.id}`;
  if (!slot.occupiedByPlayerId) return `Plot ${slot.id}`;
  const team = Object.values(state.teams.teams).find((entry) => entry.ownerPlayerId === slot.occupiedByPlayerId);
  if (team && team.teamPlotEnabled) return `${team.name} Plot`;
  const ownerName = Object.entries(state.stats.playerIds).find(([, pid]) => pid === slot.occupiedByPlayerId)?.[0];
  return ownerName ? `${ownerName}'s Plot` : `Plot ${slot.id}`;
}

export function findFreeSlotId(): string | undefined {
  for (const slot of getPlotSlots()) {
    if (!slot.occupiedByPlayerId) return slot.id;
  }
  return undefined;
}

export function assignPlayerToSlot(player: Player, slotId: string): { ok: boolean; message: string } {
  const slot = state.plots.slots[slotId];
  if (!slot) return { ok: false, message: "Slot not found." };
  if (slot.occupiedByPlayerId) return { ok: false, message: "Slot already occupied." };
  const playerId = getPlayerId(player);
  const ownerPlayerId = getPlotOwnerIdForPlayerId(playerId);
  const previous = state.plots.playerToSlot[ownerPlayerId];
  if (previous && previous !== slotId) {
    const previousSlot = state.plots.slots[previous];
    if (previousSlot) {
      if (!saveAndClearSlot(previousSlot, ownerPlayerId)) {
        return { ok: false, message: "Failed to save the current plot before reassignment." };
      }
      previousSlot.occupiedByPlayerId = undefined;
    }
  }
  state.plots.playerToSlot[ownerPlayerId] = slotId;
  slot.occupiedByPlayerId = ownerPlayerId;
  clearSlot(slot);
  loadSlotSnapshot(slot, ownerPlayerId);
  saveSlotSnapshot(slot, ownerPlayerId, captureSlotGenerators(slot, ownerPlayerId));
  savePlots();
  return { ok: true, message: `Assigned ${player.name} to ${slotId}.` };
}

export function teleportPlayerToSlot(player: Player, slotId: string): { ok: boolean; message: string } {
  const slot = state.plots.slots[slotId];
  if (!slot) return { ok: false, message: "Slot not found." };
  const dim = getDimension();
  if (player.dimension.id !== dim.id) return { ok: false, message: `Player is in ${player.dimension.id}, slot is in ${dim.id}.` };
  const cx = (slot.min.x + slot.max.x) / 2 + 0.5;
  const cz = (slot.min.z + slot.max.z) / 2 + 0.5;
  player.teleport({ x: cx, y: slot.min.y + 1, z: cz }, { dimension: dim });
  return { ok: true, message: `Teleported to ${slotId}.` };
}

export function assignPlayerToFreeSlot(player: Player): { ok: boolean; message: string } {
  const free = findFreeSlotId();
  if (!free) return { ok: false, message: "No available plot slots." };
  return assignPlayerToSlot(player, free);
}

export function clearAllPlotSlots(): { ok: boolean; message: string } {
  const slots = getPlotSlots();
  if (slots.length === 0) return { ok: false, message: "No plot slots configured." };
  let cleared = 0;
  for (const slot of slots) {
    if (slot.occupiedByPlayerId) continue;
    clearSlot(slot);
    cleared += 1;
  }
  savePlots();
  return { ok: true, message: `Cleaned ${cleared} free plot slots. Assigned plots were left alone.` };
}

export function clearSlotById(slotId: string): { ok: boolean; message: string } {
  const slot = state.plots.slots[slotId];
  if (!slot) return { ok: false, message: "Slot not found." };
  const previousOwnerId = slot.occupiedByPlayerId;
  if (slot.occupiedByPlayerId) {
    if (!saveAndClearSlot(slot, slot.occupiedByPlayerId)) {
      return { ok: false, message: "Failed to save slot snapshot before clearing." };
    }
  } else {
    clearSlot(slot);
  }
  slot.occupiedByPlayerId = undefined;
  if (previousOwnerId) delete state.plots.playerToSlot[previousOwnerId];
  savePlots();
  return { ok: true, message: `Cleared slot ${slotId}.` };
}

export function forceReleasePlot(slotId: string): boolean {
  const slot = state.plots.slots[slotId];
  if (!slot) return false;
  if (slot.occupiedByPlayerId) {
    if (!saveAndClearSlot(slot, slot.occupiedByPlayerId)) return false;
    delete state.plots.playerToSlot[slot.occupiedByPlayerId];
  } else {
    clearSlot(slot);
  }
  slot.occupiedByPlayerId = undefined;
  savePlots();
  return true;
}

export function ensurePlayerPlotAssigned(player: Player): { ok: boolean; assigned: boolean; message: string } {
  if (!state.plots.config.enabled) {
    return { ok: true, assigned: false, message: "Plots are disabled." };
  }

  const playerId = getPlayerId(player);
  const ownerId = getPlotOwnerIdForPlayerId(playerId);
  const team = getPlayerTeam(player);
  if (team?.teamPlotEnabled && ownerId !== playerId) {
    return { ok: true, assigned: false, message: "Team member plot suspended while team plot is enabled." };
  }

  const slotId = resolveAuthoritativeOwnedSlotId(ownerId) ?? state.plots.playerToSlot[ownerId];
  const slot = slotId ? state.plots.slots[slotId] : undefined;
  if (slot && slot.occupiedByPlayerId === ownerId) {
    if (state.plots.playerToSlot[ownerId] !== slot.id) {
      state.plots.playerToSlot[ownerId] = slot.id;
      savePlots();
    }
    return { ok: true, assigned: false, message: `Plot ${slot.id} already assigned.` };
  }

  const deployed = deployPlayerPlot(player);
  return { ok: deployed.ok, assigned: deployed.ok, message: deployed.message };
}

export function clearPlayerPlot(playerId: string): boolean {
  const slotId = state.plots.playerToSlot[playerId];
  if (!slotId) return true;
  const result = releasePlayerPlotById(playerId);
  return result.ok;
}

export function deployPlayerPlot(player: Player): { ok: boolean; message: string } {
  if (!state.plots.config.enabled) return { ok: true, message: "Plots disabled." };
  const ownerId = getPlotOwnerIdForPlayer(player) ?? getPlayerId(player);

  const assigned = resolveAuthoritativeOwnedSlotId(ownerId) ?? state.plots.playerToSlot[ownerId];
  let slotId: string;
  if (!assigned || !state.plots.slots[assigned]) {
    const free = findFreeSlotId();
    if (!free) return { ok: false, message: "No available plot slots." };
    slotId = free;
    state.plots.playerToSlot[ownerId] = free;
  } else {
    slotId = assigned;
  }

  const slot = state.plots.slots[slotId];
  if (!slot) return { ok: false, message: "Assigned slot not found." };
  const dim = getDimension();
  if (slot.occupiedByPlayerId && slot.occupiedByPlayerId !== ownerId) {
    return { ok: false, message: "Assigned plot is occupied." };
  }

  slot.occupiedByPlayerId = ownerId;
  clearSlot(slot);
  loadSlotSnapshot(slot, ownerId);
  applyAutoBuildRoof(slot);
  saveSlotSnapshot(slot, ownerId, captureSlotGenerators(slot, ownerId));
  savePlots();
  return { ok: true, message: `Plot ${slotId} deployed.` };
}

export function getPlotOwnerIdForPlayer(player: Player): string | undefined {
  return getPlotOwnerIdForPlayerId(getPlayerId(player));
}

export function saveAssignedPlayerPlot(player: Player): boolean {
  const ownerId = getPlotOwnerIdForPlayer(player);
  if (!ownerId) return false;
  const slotId = state.plots.playerToSlot[ownerId];
  if (!slotId) return false;
  const slot = state.plots.slots[slotId];
  if (!slot) return false;
  const saved = saveSlotSnapshot(slot, ownerId, captureSlotGenerators(slot, ownerId));
  if (saved) savePlots();
  return saved;
}

export function savePlotAtLocation(location: Vector3): boolean {
  const slot = getPlotForLocation(location);
  if (!slot || !slot.occupiedByPlayerId) return false;
  const saved = saveSlotSnapshot(slot, slot.occupiedByPlayerId, captureSlotGenerators(slot, slot.occupiedByPlayerId));
  if (saved) savePlots();
  return saved;
}

export function releasePlayerPlotByName(playerName: string): { ok: boolean; message: string } {
  const playerId = state.stats.playerIds[playerName];
  if (!playerId) return { ok: false, message: "Player ID not found." };
  return releasePlayerPlotById(playerId);
}

export function releasePlayerPlotById(playerId: string): { ok: boolean; message: string } {
  const slotId = state.plots.playerToSlot[playerId];
  if (!slotId) return { ok: false, message: "No assigned plot." };
  const slot = state.plots.slots[slotId];
  if (!slot) return { ok: false, message: "Assigned slot missing." };

  if (!saveAndClearSlot(slot, playerId)) {
    return { ok: false, message: "Failed to save plot snapshot before release." };
  }
  slot.occupiedByPlayerId = undefined;
  delete state.plots.playerToSlot[playerId];
  savePlots();
  return { ok: true, message: `Plot ${slotId} saved and cleared.` };
}

export function showPlotError(player: Player, message: string) {
  tell(player, `§c[Plots] ${message}`);
}

export function getPlotTitle(slot: PlotSlot): string {
  const key = plotTitleCacheKey(slot);
  const cached = plotTitleCache.get(slot.id);
  if (cached?.key === key) return cached.title;
  const title = buildPlotTitle(slot);
  plotTitleCache.set(slot.id, { key, title });
  return title;
}
