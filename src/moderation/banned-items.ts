import { ItemStack, Player, world } from "@minecraft/server";
import { getInventoryContainer, state } from "../storage";
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

export function clearBannedHeldSlot(player: Player): boolean {
  const container = getInventoryContainer(player);
  if (!container) return false;
  const held = container.getItem(player.selectedSlotIndex);
  if (!held || !isBannedItemId(held.typeId)) return false;
  container.setItem(player.selectedSlotIndex, undefined);
  return true;
}

export function clearBannedInventory(player: Player): number {
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
  if (state.moderation.bannedItems.length === 0) return false;
  const container = getInventoryContainer(player);
  if (!container) return false;

  let blocked = false;
  const clearSelectedSlot = (): void => {
    container.setItem(player.selectedSlotIndex, undefined);
    blocked = true;
    if (cancelTarget) cancelTarget.cancel = true;
  };

  if (itemStack && isBannedItemId(itemStack.typeId)) clearSelectedSlot();
  const held = container.getItem(player.selectedSlotIndex);
  if (held && isBannedItemId(held.typeId)) clearSelectedSlot();
  return blocked;
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
