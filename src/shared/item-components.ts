import { EntityComponentTypes, ItemComponentTypes, ItemStack, type Entity } from "@minecraft/server";

type EnchantableComponent = {
  getEnchantments(): { type?: { id?: string }; typeId?: string; level: number }[];
  addEnchantments?(entries: { type: { id: string }; level: number }[]): void;
};

type DurabilityComponent = {
  damage: number;
  maxDurability: number;
};

type BlockListComponent = {
  blocks: string[];
};

type HealthComponent = {
  currentValue: number;
  defaultValue?: number;
  setCurrentValue(value: number): void;
};

export function getItemEnchantableComponent(stack: ItemStack): EnchantableComponent | undefined {
  return stack.getComponent(ItemComponentTypes.Enchantable) as unknown as EnchantableComponent | undefined;
}

export type StackEnchantment = { id: string; level: number };

export function readStackEnchantments(stack: ItemStack): StackEnchantment[] {
  try {
    const enchantable = getItemEnchantableComponent(stack);
    const entries = enchantable?.getEnchantments() ?? [];
    return entries
      .map((entry) => ({ id: entry.type?.id ?? entry.typeId ?? "", level: entry.level }))
      .filter((entry) => entry.id.length > 0);
  } catch {
    return [];
  }
}

export function getItemDurabilityComponent(stack: ItemStack): DurabilityComponent | undefined {
  return stack.getComponent(ItemComponentTypes.Durability) as unknown as DurabilityComponent | undefined;
}

export function getItemCanPlaceOnComponent(stack: ItemStack): BlockListComponent | undefined {
  return stack.getComponent("minecraft:can_place_on") as unknown as BlockListComponent | undefined;
}

export function getItemCanDestroyComponent(stack: ItemStack): BlockListComponent | undefined {
  return stack.getComponent("minecraft:can_destroy") as unknown as BlockListComponent | undefined;
}

export function getEntityHealthComponent(entity: Entity): HealthComponent | undefined {
  return entity.getComponent(EntityComponentTypes.Health) as unknown as HealthComponent | undefined;
}
