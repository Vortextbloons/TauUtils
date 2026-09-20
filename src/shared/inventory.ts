import { Container, ItemStack, Player } from "@minecraft/server";
import { getInventoryContainer } from "../storage";

export type InventorySnapshot = {
  size: number;
  slots: (ItemStack | undefined)[];
};

export type EscrowGiveResult = {
  ok: boolean;
  dropped: boolean;
};

export function snapshotInventory(player: Player): { container: Container; snapshot: InventorySnapshot } | undefined {
  const container = getInventoryContainer(player);
  if (!container) return undefined;
  const slots: (ItemStack | undefined)[] = [];
  for (let slot = 0; slot < container.size; slot++) {
    try {
      const stack = container.getItem(slot);
      slots.push(stack ? stack.clone() : undefined);
    } catch {
      slots.push(undefined);
    }
  }
  return { container, snapshot: { size: container.size, slots } };
}

export function restoreInventorySnapshot(container: Container, snapshot: InventorySnapshot): void {
  const count: number = Math.min(container.size, snapshot.slots.length);
  for (let slot = 0; slot < count; slot++) {
    try {
      const stack = snapshot.slots[slot];
      container.setItem(slot, stack ? stack.clone() : undefined);
    } catch {
      // Ignore per-slot restore errors; best effort rollback.
    }
  }
}

export function tryGiveWithEscrow(player: Player, stack: ItemStack): EscrowGiveResult {
  const captured = snapshotInventory(player);
  if (!captured) {
    try {
      player.dimension.spawnItem(stack, player.location);
      return { ok: true, dropped: true };
    } catch {
      return { ok: false, dropped: false };
    }
  }
  // Clone the input up front: addItem may partially consume it, and on a
  // partial fit we restore the snapshot (wiping the fitted portion) then
  // drop the FULL original stack so no items are destroyed.
  let pristine: ItemStack;
  try {
    pristine = stack.clone();
  } catch {
    return { ok: false, dropped: false };
  }
  let leftover: ItemStack | undefined;
  try {
    leftover = captured.container.addItem(stack);
  } catch {
    restoreInventorySnapshot(captured.container, captured.snapshot);
    return { ok: false, dropped: false };
  }
  if (!leftover) return { ok: true, dropped: false };
  restoreInventorySnapshot(captured.container, captured.snapshot);
  try {
    player.dimension.spawnItem(pristine, player.location);
    return { ok: true, dropped: true };
  } catch {
    return { ok: false, dropped: false };
  }
}
