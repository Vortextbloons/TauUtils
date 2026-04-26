import { Player } from "@minecraft/server";
import { type PlotSlot, type PlotSnapshot, type TeamDefinition } from "../types";
import { getPlayerId, state, savePlots, saveGenerators } from "../storage";
import { getPlotSlots } from "./grid";
import { clearSlot, saveAndClearSlot, captureSlotGenerators, saveSlotSnapshot, getPlotForLocation, isGeneratorInSlot, snapshotQueue } from "./build";

function getTeamForPlayerId(playerId: string): TeamDefinition | undefined {
  const teamId = state.teams.playerTeamIds[playerId];
  if (!teamId) return undefined;
  return state.teams.teams[teamId];
}

function hasOnlinePlotAccess(ownerPlayerId: string, onlineIds: Set<string>): boolean {
  if (onlineIds.has(ownerPlayerId)) return true;
  const team = Object.values(state.teams.teams).find((entry) => entry.ownerPlayerId === ownerPlayerId && entry.teamPlotEnabled);
  if (!team) return false;
  return team.memberPlayerIds.some((memberId) => onlineIds.has(memberId));
}

function shouldSuspendTeamMemberPlot(playerId: string): boolean {
  const team = getTeamForPlayerId(playerId);
  return Boolean(team?.teamPlotEnabled && team.ownerPlayerId !== playerId);
}

function countGeneratorsInSlot(slot: PlotSlot): number {
  let count = 0;
  for (const generator of Object.values(state.generators.placed)) {
    if (isGeneratorInSlot(generator, slot)) count += 1;
  }
  return count;
}

function findOccupiedPlotSlotId(ownerPlayerId: string): string | undefined {
  let bestSlotId: string | undefined;
  let bestGeneratorCount = -1;

  for (const slot of getPlotSlots()) {
    if (slot.occupiedByPlayerId !== ownerPlayerId) continue;
    const generatorCount = countGeneratorsInSlot(slot);
    if (generatorCount > bestGeneratorCount) {
      bestGeneratorCount = generatorCount;
      bestSlotId = slot.id;
    }
  }

  return bestSlotId;
}

export function resolveAuthoritativeOwnedSlotId(ownerPlayerId: string): string | undefined {
  if (shouldSuspendTeamMemberPlot(ownerPlayerId)) return undefined;

  const snapshotSlotId = state.plots.snapshots[ownerPlayerId]?.slotId;
  if (snapshotSlotId) {
    const snapshotSlot = state.plots.slots[snapshotSlotId];
    if (snapshotSlot && snapshotSlot.occupiedByPlayerId === ownerPlayerId) return snapshotSlotId;
  }

  const mappedSlotId = state.plots.playerToSlot[ownerPlayerId];
  if (mappedSlotId) {
    const mappedSlot = state.plots.slots[mappedSlotId];
    if (mappedSlot && mappedSlot.occupiedByPlayerId === ownerPlayerId) return mappedSlotId;
  }

  const occupiedSlotId = findOccupiedPlotSlotId(ownerPlayerId);
  if (occupiedSlotId) return occupiedSlotId;

  if (mappedSlotId) return mappedSlotId;
  if (snapshotSlotId) return snapshotSlotId;
  return undefined;
}

export function repairOwnedPlotSlots(ownerPlayerId: string, authoritativeSlotId: string): boolean {
  let changed = false;
  for (const slot of getPlotSlots()) {
    if (slot.id === authoritativeSlotId) continue;
    if (slot.occupiedByPlayerId !== ownerPlayerId) continue;
    clearSlot(slot);
    slot.occupiedByPlayerId = undefined;
    changed = true;
  }

  const authoritativeSlot = state.plots.slots[authoritativeSlotId];
  if (authoritativeSlot && authoritativeSlot.occupiedByPlayerId !== ownerPlayerId) {
    authoritativeSlot.occupiedByPlayerId = ownerPlayerId;
    changed = true;
  }

  if (state.plots.playerToSlot[ownerPlayerId] !== authoritativeSlotId) {
    state.plots.playerToSlot[ownerPlayerId] = authoritativeSlotId;
    changed = true;
  }

  if (authoritativeSlot) {
    const saved = saveSlotSnapshot(authoritativeSlot, ownerPlayerId, captureSlotGenerators(authoritativeSlot, ownerPlayerId));
    changed = saved || changed;
  }

  return changed;
}

export function getPlotOwnerIdForPlayerId(playerId: string): string {
  const team = getTeamForPlayerId(playerId);
  if (team?.teamPlotEnabled) return team.ownerPlayerId;
  return playerId;
}

export function getAssignedSlotIdForOwner(ownerPlayerId: string): string | undefined {
  return resolveAuthoritativeOwnedSlotId(ownerPlayerId) ?? state.plots.playerToSlot[ownerPlayerId];
}

export function getAssignedSlotForOwner(ownerPlayerId: string): PlotSlot | undefined {
  const slotId = getAssignedSlotIdForOwner(ownerPlayerId);
  if (!slotId) return undefined;
  return state.plots.slots[slotId];
}

export function getAssignedSlotForPlayer(player: Player): PlotSlot | undefined {
  const ownerPlayerId = getPlotOwnerIdForPlayerId(getPlayerId(player));
  if (!ownerPlayerId) return undefined;
  return getAssignedSlotForOwner(ownerPlayerId);
}

export function reconcilePlotOwnershipData(): { ok: boolean; mappingsFixed: number; snapshotsFixed: number; generatorsFixed: number; message: string } {
  let mappingsFixed = 0;
  let snapshotsFixed = 0;
  let generatorsFixed = 0;

  const nextSnapshots: Record<string, PlotSnapshot> = {};
  for (const [playerId, snapshot] of Object.entries(state.plots.snapshots)) {
    const ownerPlayerId = getPlotOwnerIdForPlayerId(playerId);
    const current = nextSnapshots[ownerPlayerId];
    if (!current || (snapshot.savedAt ?? 0) >= (current.savedAt ?? 0)) {
      nextSnapshots[ownerPlayerId] = snapshot;
    }
    if (ownerPlayerId !== playerId) snapshotsFixed += 1;
  }
  state.plots.snapshots = nextSnapshots;

  const nextPlayerToSlot: Record<string, string> = {};
  const slots = getPlotSlots();

  for (const slot of slots) {
    const occupant = slot.occupiedByPlayerId;
    if (!occupant) continue;
    if (shouldSuspendTeamMemberPlot(occupant)) {
      if (!saveAndClearSlot(slot, occupant)) {
        snapshotQueue.push({ playerId: occupant, slotId: slot.id, mode: "save", attempts: 0, generators: captureSlotGenerators(slot, occupant) });
      }
      slot.occupiedByPlayerId = undefined;
      mappingsFixed += 1;
      continue;
    }
    const ownerPlayerId = getPlotOwnerIdForPlayerId(occupant);
    const authoritativeSlotId = resolveAuthoritativeOwnedSlotId(ownerPlayerId) ?? slot.id;
    if (slot.id !== authoritativeSlotId) {
      clearSlot(slot);
      slot.occupiedByPlayerId = undefined;
      mappingsFixed += 1;
      continue;
    }
    if (slot.occupiedByPlayerId !== ownerPlayerId) {
      slot.occupiedByPlayerId = ownerPlayerId;
      mappingsFixed += 1;
    }
    nextPlayerToSlot[ownerPlayerId] = slot.id;
  }

  for (const [playerId, slotId] of Object.entries(state.plots.playerToSlot)) {
    const slot = state.plots.slots[slotId];
    if (!slot) {
      mappingsFixed += 1;
      continue;
    }
    if (shouldSuspendTeamMemberPlot(playerId)) {
      if (!saveAndClearSlot(slot, playerId)) {
        snapshotQueue.push({ playerId, slotId: slot.id, mode: "save", attempts: 0, generators: captureSlotGenerators(slot, playerId) });
      }
      slot.occupiedByPlayerId = undefined;
      mappingsFixed += 1;
      delete state.plots.playerToSlot[playerId];
      continue;
    }
    const ownerPlayerId = getPlotOwnerIdForPlayerId(playerId);
    const authoritativeSlotId = resolveAuthoritativeOwnedSlotId(ownerPlayerId) ?? slotId;
    if (!nextPlayerToSlot[ownerPlayerId]) {
      nextPlayerToSlot[ownerPlayerId] = authoritativeSlotId;
    }
    if (nextPlayerToSlot[ownerPlayerId] !== authoritativeSlotId) {
      mappingsFixed += 1;
      nextPlayerToSlot[ownerPlayerId] = authoritativeSlotId;
    }
    if (slot.id !== authoritativeSlotId) {
      clearSlot(slot);
      slot.occupiedByPlayerId = undefined;
      mappingsFixed += 1;
      continue;
    }
    if (ownerPlayerId !== playerId) mappingsFixed += 1;
  }

  state.plots.playerToSlot = nextPlayerToSlot;

  for (const [ownerPlayerId, slotId] of Object.entries(nextPlayerToSlot)) {
    if (repairOwnedPlotSlots(ownerPlayerId, slotId)) mappingsFixed += 1;
  }

  for (const [ownerPlayerId, snapshot] of Object.entries(state.plots.snapshots)) {
    if (!snapshot.generators || snapshot.generators.length === 0) continue;
    for (const entry of snapshot.generators) {
      if (entry.ownerPlayerId === ownerPlayerId) continue;
      entry.ownerPlayerId = ownerPlayerId;
      generatorsFixed += 1;
    }
  }

  for (const placed of Object.values(state.generators.placed)) {
    const slot = getPlotForLocation({ x: placed.x, y: placed.y, z: placed.z });
    const ownerPlayerId = slot?.occupiedByPlayerId;
    if (!ownerPlayerId) continue;
    if (placed.ownerPlayerId === ownerPlayerId) continue;
    placed.ownerPlayerId = ownerPlayerId;
    generatorsFixed += 1;
  }

  if (mappingsFixed > 0 || snapshotsFixed > 0) savePlots();
  if (generatorsFixed > 0) saveGenerators();
  return {
    ok: true,
    mappingsFixed,
    snapshotsFixed,
    generatorsFixed,
    message: `Reconciled plots (mappings=${mappingsFixed}, snapshots=${snapshotsFixed}, generators=${generatorsFixed}).`,
  };
}

export function reconcileTeamPlotSlots(): boolean {
  let changed = false;
  for (const team of Object.values(state.teams.teams)) {
    if (!team.teamPlotEnabled) continue;
    if (!team.personalPlotSlotIds) team.personalPlotSlotIds = {};
    const ownerSlotId = state.plots.playerToSlot[team.ownerPlayerId];
    if (!ownerSlotId) continue;
    const ownerSlot = state.plots.slots[ownerSlotId];
    if (ownerSlot && ownerSlot.occupiedByPlayerId !== team.ownerPlayerId) {
      ownerSlot.occupiedByPlayerId = team.ownerPlayerId;
      changed = true;
    }

    for (const memberId of team.memberPlayerIds) {
      if (memberId === team.ownerPlayerId) continue;
      const mappedSlotId = state.plots.playerToSlot[memberId];
      const savedSlotId = team.personalPlotSlotIds[memberId] ?? mappedSlotId;
      if (savedSlotId && team.personalPlotSlotIds[memberId] !== savedSlotId) {
        team.personalPlotSlotIds[memberId] = savedSlotId;
        changed = true;
      }

      if (mappedSlotId) {
        const mappedSlot = state.plots.slots[mappedSlotId];
        if (mappedSlot && mappedSlot.occupiedByPlayerId === memberId) {
          if (saveAndClearSlot(mappedSlot, memberId)) changed = true;
          mappedSlot.occupiedByPlayerId = undefined;
          changed = true;
        }
        delete state.plots.playerToSlot[memberId];
        changed = true;
      }

      const savedSlot = savedSlotId ? state.plots.slots[savedSlotId] : undefined;
      if (savedSlot && savedSlot.occupiedByPlayerId === memberId) {
        if (saveAndClearSlot(savedSlot, memberId)) changed = true;
        savedSlot.occupiedByPlayerId = undefined;
        changed = true;
      }
    }
  }

  if (changed) savePlots();
  return changed;
}
