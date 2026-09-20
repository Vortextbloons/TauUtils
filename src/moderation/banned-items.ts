import { ItemStack, Player, system, world } from "@minecraft/server";
import { getInventoryContainer, isOperator, state } from "../storage";
import { normalizeItemId } from "../shared/item-id";

let bannedItemIds = new Set<string>();
let bannedItemCacheSize = -1;

export function invalidateBannedItemCache(): void {
  bannedItemCacheSize = -1;
}

function ensureBannedItemCache(): Set<string> {
  const count = state.moderation.bannedItems.length;
  if (bannedItemCacheSize === count && bannedItemCacheSize >= 0) return bannedItemIds;
  bannedItemIds = new Set(state.moderation.bannedItems.map((entry) => normalizeItemId(entry.itemId)));
  bannedItemCacheSize = count;
  return bannedItemIds;
}

export function isBannedItemId(itemId: string): boolean {
  if (state.moderation.bannedItems.length === 0) return false;
  return ensureBannedItemCache().has(normalizeItemId(itemId));
}

export function clearBannedInventory(player: Player): number {
  if (isOperator(player)) return 0;
  const container = getInventoryContainer(player);
  if (!container) return 0;
  let removed = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (!stack || !isBannedItemId(stack.typeId)) continue;
    removed += stack.amount;
    container.setItem(slot, undefined);
  }
  return removed;
}

type Cancelable = { cancel: boolean };

export function enforceBannedItemUse(player: Player, itemStack?: ItemStack, cancelTarget?: Cancelable): boolean {
  if (isOperator(player)) return false;
  if (state.moderation.bannedItems.length === 0) return false;

  // Synchronous before-event section: reads + cancel decision only.
  // Inventory mutation is deferred to system.run below (before-events are read-only).
  let eventStackBanned = false;
  try {
    eventStackBanned = itemStack ? isBannedItemId(itemStack.typeId) : false;
  } catch {
    eventStackBanned = false;
  }
  let heldSlot = -1;
  try {
    const container = getInventoryContainer(player);
    const held = container?.getItem(player.selectedSlotIndex);
    if (held && isBannedItemId(held.typeId)) heldSlot = player.selectedSlotIndex;
  } catch {
    heldSlot = -1;
  }
  if (!eventStackBanned && heldSlot < 0) return false;
  if (cancelTarget) cancelTarget.cancel = true;

  // Snapshot taken synchronously; verified again in the deferred pass so a
  // legitimate item swapped into the slot during the gap is never deleted.
  const snapshotSlot = heldSlot >= 0 ? heldSlot : player.selectedSlotIndex;
  system.run(() => {
    try {
      if (!player.isValid) return;
      const container = getInventoryContainer(player);
      if (!container) return;
      let currentTypeId: string | undefined;
      try {
        currentTypeId = container.getItem(snapshotSlot)?.typeId;
      } catch {
        return;
      }
      if (!currentTypeId || !isBannedItemId(currentTypeId)) return;
      container.setItem(snapshotSlot, undefined);
    } catch {
      // ignore deferred cleanup errors
    }
  });
  return true;
}

export function snapshotContainerExcludingBanned(
  container: { size: number; getItem(slot: number): ItemStack | undefined; setItem(slot: number, item?: ItemStack): void; isValid?: boolean },
  slotCount?: number
): Array<{ slot: number; itemId: string; amount: number; nameTag?: string; lore?: string[] }> | undefined {
  try {
    if (container.isValid === false) return undefined;
    const snapshot: Array<{ slot: number; itemId: string; amount: number; nameTag?: string; lore?: string[] }> = [];
    const totalSlots = Math.max(0, Math.floor(Math.min(slotCount ?? container.size ?? 0, container.size ?? 0)));
    for (let slot = 0; slot < totalSlots; slot++) {
      const stack = container.getItem(slot);
      if (!stack) continue;
      if (isBannedItemId(stack.typeId)) {
        container.setItem(slot, undefined);
        continue;
      }
      snapshot.push({
        slot,
        itemId: stack.typeId,
        amount: stack.amount,
        nameTag: stack.nameTag?.trim() || undefined,
        lore: stack.getLore().map((line) => String(line).trim()).filter((line) => line.length > 0),
      });
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

export function sweepBannedItemsFromOnlinePlayers(): number {
  let totalRemoved = 0;
  for (const player of world.getAllPlayers()) {
    totalRemoved += clearBannedInventory(player);
  }
  return totalRemoved;
}
