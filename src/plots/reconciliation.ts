import { Player, world } from "@minecraft/server";
import { type PlotSlot } from "../types";
import { getPlayerId, savePlots, state } from "../storage";
import { getPlotSlots, invalidatePlotSlotCache } from "./grid";
import { reorderPlotSlots, saveAndClearSlot } from "./build";
import { reconcilePlotOwnershipData, reconcileTeamPlotSlots, resolveAuthoritativeOwnedSlotId, repairOwnedPlotSlots, getPlotOwnerIdForPlayerId } from "./ownership";
import { deployPlayerPlot } from "./player-ops";

function reconcileOnlinePlotAssignmentsInternal(reason: string): { ok: boolean; assigned: number; fixed: number; failed: number; message: string } {
  const reconciled = reconcileAllPlotState(reason);
  return {
    ok: reconciled.ok,
    assigned: reconciled.assigned,
    fixed: reconciled.fixed,
    failed: reconciled.failed,
    message: reconciled.message,
  };
}

export function syncOnlinePlotAssignments(): { ok: boolean; assigned: number; fixed: number; failed: number; message: string } {
  return reconcileOnlinePlotAssignmentsInternal("sync");
}

export function ensureOnlinePlotsAssigned(): { ok: boolean; assigned: number; failed: number; message: string } {
  const reconciled = reconcileOnlinePlotAssignmentsInternal("ensure_online");
  return {
    ok: reconciled.ok,
    assigned: reconciled.assigned,
    failed: reconciled.failed,
    message: `Ensured plots for ${reconciled.assigned} online player(s).`,
  };
}

export type PlotReconcileResult = {
  ok: boolean;
  fixed: number;
  assigned: number;
  failed: number;
  reordered: boolean;
  message: string;
};

function releaseOwnedPlotSlot(slot: PlotSlot): boolean {
  const ownerId = slot.occupiedByPlayerId;
  if (!ownerId) return false;

  const didSave = saveAndClearSlot(slot, ownerId);
  if (!didSave) return false;

  slot.occupiedByPlayerId = undefined;
  if (state.plots.playerToSlot[ownerId] === slot.id) {
    delete state.plots.playerToSlot[ownerId];
  }
  return true;
}

function shouldClearOfflinePlots(reason: string): boolean {
  return reason.startsWith("startup");
}

function clearOfflinePlotAssignments(onlineOwnerIds: Set<string>): number {
  let cleared = 0;
  const seenOwnerIds = new Set<string>();

  for (const slot of getPlotSlots()) {
    const ownerId = slot.occupiedByPlayerId;
    if (!ownerId || onlineOwnerIds.has(ownerId) || seenOwnerIds.has(ownerId)) continue;
    if (releaseOwnedPlotSlot(slot)) {
      seenOwnerIds.add(ownerId);
      cleared += 1;
    }
  }

  return cleared;
}

export function reconcileAllPlotState(reason: string = "general"): PlotReconcileResult {
  if (!state.plots.config.enabled) {
    return {
      ok: true,
      fixed: 0,
      assigned: 0,
      failed: 0,
      reordered: false,
      message: `Plots disabled; skipped reconcile (${reason}).`,
    };
  }

  const reordered = reorderPlotSlots();
  const ownership = reconcilePlotOwnershipData();
  const teamPlotsReconciled = reconcileTeamPlotSlots();

  const onlineOwnerIds = new Set<string>();
  const ownerRepresentatives = new Map<string, Player>();
  for (const player of world.getAllPlayers()) {
    const playerId = getPlayerId(player);
    const ownerId = getPlotOwnerIdForPlayerId(playerId);
    onlineOwnerIds.add(ownerId);
    if (!ownerRepresentatives.has(ownerId)) ownerRepresentatives.set(ownerId, player);
  }

  const offlinePlotsCleared = shouldClearOfflinePlots(reason) ? clearOfflinePlotAssignments(onlineOwnerIds) : 0;

  let assigned = 0;
  let failed = 0;
  let fixed =
    (ownership.mappingsFixed ?? 0) +
    (ownership.snapshotsFixed ?? 0) +
    (ownership.generatorsFixed ?? 0) +
    (reordered ? 1 : 0) +
    (teamPlotsReconciled ? 1 : 0) +
    offlinePlotsCleared;

  for (const [ownerId, representative] of ownerRepresentatives.entries()) {
    const slotId = resolveAuthoritativeOwnedSlotId(ownerId) ?? state.plots.playerToSlot[ownerId];
    const slot = slotId ? state.plots.slots[slotId] : undefined;
    if (slot && slot.occupiedByPlayerId === ownerId) {
      if (state.plots.playerToSlot[ownerId] !== slot.id) {
        state.plots.playerToSlot[ownerId] = slot.id;
        fixed += 1;
      }
      if (repairOwnedPlotSlots(ownerId, slot.id)) fixed += 1;
      continue;
    }

    const deployed = deployPlayerPlot(representative);
    if (deployed.ok) {
      assigned += 1;
      if (slotId) fixed += 1;
    } else {
      failed += 1;
    }
  }

  if (fixed > 0 || assigned > 0 || failed > 0) savePlots();

  invalidatePlotSlotCache();
  return {
    ok: ownership.ok && failed === 0,
    fixed,
    assigned,
    failed,
    reordered,
    message: `Reconciled plots (${reason}) fixed=${fixed} assigned=${assigned} failed=${failed}.`,
  };
}

export function repairPlotSystem(): { ok: boolean; fixed: number; assigned: number; message: string } {
  const reconciled = reconcileAllPlotState("manual_repair");
  const message = `Repaired plots: ${reconciled.fixed} fixes applied, ${reconciled.assigned} online assigned.${reconciled.reordered ? " Slot order normalized." : ""}`;
  return { ok: reconciled.ok, fixed: reconciled.fixed, assigned: reconciled.assigned, message };
}
