import { EntityComponentTypes, system, world, type Player } from "@minecraft/server";
import {
  asPlayer,
  getInventoryContainer,
  isFeatureEnabled,
  saveModeration,
  state,
} from "../storage";
import {
  enforceBannedItemUse,
  snapshotContainerExcludingBanned,
} from "../moderation/banned-items";
import { getCachedPlayers } from "./player-cache";

function snapshotsEqual(
  left: Array<{ slot: number; itemId: string; amount: number; nameTag?: string; lore?: string[] }> | undefined,
  right: Array<{ slot: number; itemId: string; amount: number; nameTag?: string; lore?: string[] }> | undefined,
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const first = a[index];
    const second = b[index];
    if (!second) return false;
    if (first.slot !== second.slot) return false;
    if (first.itemId !== second.itemId) return false;
    if (first.amount !== second.amount) return false;
    if ((first.nameTag ?? "") !== (second.nameTag ?? "")) return false;
    const firstLore = first.lore ?? [];
    const secondLore = second.lore ?? [];
    if (firstLore.length !== secondLore.length) return false;
    for (let loreIndex = 0; loreIndex < firstLore.length; loreIndex++) {
      if (firstLore[loreIndex] !== secondLore[loreIndex]) return false;
    }
  }
  return true;
}

export function cacheModerationInspectionSnapshot(player: Player | undefined): boolean {
  if (!isFeatureEnabled("moderation")) return false;
  if (!player) return false;
  try {
    state.moderation.inspectionSnapshots ??= {};
    const key = player.name.toLowerCase();
    const current = state.moderation.inspectionSnapshots[key];
    const inventory = getInventoryContainer(player);
    const inventorySnapshot = inventory ? (snapshotContainerExcludingBanned(inventory) ?? (current?.inventory ?? [])) : (current?.inventory ?? []);
    const enderInventory = player.getComponent(EntityComponentTypes.EnderInventory)?.container;
    const enderChestSnapshot = enderInventory ? (snapshotContainerExcludingBanned(enderInventory) ?? (current?.enderChest ?? [])) : (current?.enderChest ?? []);
    if (
      current
      && current.playerName === player.name
      && snapshotsEqual(current.inventory, inventorySnapshot)
      && snapshotsEqual(current.enderChest, enderChestSnapshot)
    ) {
      return false;
    }
    state.moderation.inspectionSnapshots[key] = {
      playerName: player.name,
      updatedAt: Date.now(),
      inventory: inventorySnapshot,
      enderChest: enderChestSnapshot,
    };
    return true;
  } catch {
    return false;
  }
}

let moderationSnapshotJobId: number | undefined;
let moderationSnapshotCursor = 0;

function processModerationSnapshotTick(
  players: Player[],
  getNextPlayer: () => Player | undefined,
  advanceCursor: () => void,
  perTick: number,
): void {
  if (!isFeatureEnabled("moderation")) {
    // Mirror combat pattern: cancel a mid-flight snapshot job when disabled.
    if (moderationSnapshotJobId !== undefined) {
      system.clearJob(moderationSnapshotJobId);
      moderationSnapshotJobId = undefined;
    }
    return;
  }
  if (players.length === 0 || moderationSnapshotJobId !== undefined) return;
  moderationSnapshotJobId = system.runJob(processModerationSnapshotJob(getNextPlayer, advanceCursor, perTick));
}

function* processModerationSnapshotJob(
  getNextPlayer: () => Player | undefined,
  advanceCursor: () => void,
  perTick: number,
): Generator<void, void, void> {
  let changed = false;
  for (let index = 0; index < perTick; index++) {
    if (!isFeatureEnabled("moderation")) break;
    const player = getNextPlayer();
    if (player && cacheModerationInspectionSnapshot(player)) changed = true;
    advanceCursor();
    yield;
  }
  if (changed) saveModeration();
  moderationSnapshotJobId = undefined;
}

/** Task entry for the orchestrator: cursor-budgeted snapshot pass, reuses the tick's cached players. */
export function processModerationSnapshotBackgroundTick(): void {
  if (!isFeatureEnabled("moderation")) {
    if (moderationSnapshotJobId !== undefined) {
      system.clearJob(moderationSnapshotJobId);
      moderationSnapshotJobId = undefined;
    }
    return;
  }
  const players = getCachedPlayers();
  if (players.length === 0) return;
  const perTick = Math.max(1, Math.ceil(players.length / 20));
  processModerationSnapshotTick(
    players,
    () => players[moderationSnapshotCursor % players.length],
    () => { moderationSnapshotCursor++; },
    perTick,
  );
}

export function registerModerationEvents(): void {
  world.beforeEvents.itemUse.subscribe((event) => {
    if (!isFeatureEnabled("moderation")) return;
    const player = asPlayer(event.source);
    if (!player) return;
    enforceBannedItemUse(player, event.itemStack, event);
  });
}
