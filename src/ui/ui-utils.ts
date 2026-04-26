import { Player, world, ItemStack, EntityComponentTypes, ItemComponentTypes } from "@minecraft/server";
import type { CrateItemReward } from "../types";
import { state, tell, getInventoryContainer } from "../storage";

export function getHeldItemSnapshot(player: Player): {
  itemId: string;
  displayName?: string;
  lore?: string[];
  enchantments?: { id: string; level: number }[];
  durability?: number;
  maxDurability?: number;
  customData?: string;
  canPlaceOn?: string[];
  canDestroy?: string[];
} | undefined {
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  const held = container?.getItem(player.selectedSlotIndex);
  if (!held) return undefined;

  const snapshot: {
    itemId: string;
    displayName?: string;
    lore?: string[];
    enchantments?: { id: string; level: number }[];
    durability?: number;
    maxDurability?: number;
    customData?: string;
    canPlaceOn?: string[];
    canDestroy?: string[];
  } = {
    itemId: held.typeId,
    displayName: held.nameTag?.trim() || undefined,
    lore: held.getLore().map((line) => String(line)),
  };

  const enchantComp = held.getComponent(ItemComponentTypes.Enchantable) as any;
  if (enchantComp?.getEnchantments) {
    try {
      snapshot.enchantments = enchantComp.getEnchantments().map((entry: any) => ({ id: entry.type?.id ?? entry.typeId, level: entry.level }));
    } catch {
    }
  }

  const durability = held.getComponent(ItemComponentTypes.Durability) as any;
  if (durability) {
    try {
      snapshot.durability = Number(durability.damage ?? 0);
      snapshot.maxDurability = Number(durability.maxDurability ?? 0);
    } catch {
    }
  }

  try {
    const placeComp = held.getComponent("minecraft:can_place_on") as any;
    if (placeComp?.blocks) snapshot.canPlaceOn = Array.isArray(placeComp.blocks) ? placeComp.blocks.slice() : String(placeComp.blocks).split(",");
  } catch {
  }

  try {
    const destroyComp = held.getComponent("minecraft:can_destroy") as any;
    if (destroyComp?.blocks) snapshot.canDestroy = Array.isArray(destroyComp.blocks) ? destroyComp.blocks.slice() : String(destroyComp.blocks).split(",");
  } catch {
  }

  return snapshot;
}

export function heldItemToCrateReward(player: Player, label: string, weight: number, amount: number): CrateItemReward | undefined {
  const held = getHeldItemSnapshot(player);
  if (!held) return undefined;
  return {
    type: "item",
    label,
    weight,
    itemId: held.itemId,
    amount,
    displayName: held.displayName,
    lore: held.lore,
    enchantments: held.enchantments,
    durability: held.durability,
    maxDurability: held.maxDurability,
    canPlaceOn: held.canPlaceOn,
    canDestroy: held.canDestroy,
    customData: held.customData,
    nameTag: held.displayName,
  };
}

export function applyHeldItemSnapshotToGenerator(def: any, snapshot: ReturnType<typeof getHeldItemSnapshot>): void {
  if (!snapshot) return;
  def.baseItemId = snapshot.itemId;
  def.displayName = snapshot.displayName ?? def.displayName;
  def.lore = snapshot.lore;
  def.customData = snapshot.customData;
  def.enchantments = snapshot.enchantments;
  def.durability = snapshot.durability;
  def.maxDurability = snapshot.maxDurability;
  def.canPlaceOn = snapshot.canPlaceOn;
  def.canDestroy = snapshot.canDestroy;
}

export function getOnlinePlayerByName(name: string): Player | undefined {
  const normalized = String(name ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  return world.getAllPlayers().find((entry) => entry.name.toLowerCase() === normalized);
}
