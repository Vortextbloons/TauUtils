import { EnchantmentTypes, ItemComponentTypes, ItemLockMode, ItemStack, type Vector3 } from "@minecraft/server";
import { type SerializedDynamicValue, type SerializedItemStack, type SerializedVector3 } from "../types";

function isSerializedVector3(value: unknown): value is SerializedVector3 {
  if (!value || typeof value !== "object") return false;
  const vector = value as Partial<SerializedVector3>;
  return typeof vector.x === "number" && typeof vector.y === "number" && typeof vector.z === "number";
}

function toSerializedDynamicValue(value: boolean | number | string | Vector3 | undefined): SerializedDynamicValue | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.x === "number" && typeof value.y === "number" && typeof value.z === "number") {
    return { x: value.x, y: value.y, z: value.z };
  }
  return undefined;
}

function toRuntimeDynamicValue(value: SerializedDynamicValue): boolean | number | string | Vector3 {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (isSerializedVector3(value)) return { x: value.x, y: value.y, z: value.z };
  return String(value);
}

function serializeDynamicProperties(stack: ItemStack): Record<string, SerializedDynamicValue> | undefined {
  try {
    const keys = stack.getDynamicPropertyIds();
    if (keys.length === 0) return undefined;
    const serialized: Record<string, SerializedDynamicValue> = {};
    for (const key of keys) {
      const value = toSerializedDynamicValue(stack.getDynamicProperty(key));
      if (value === undefined) continue;
      serialized[key] = value;
    }
    return Object.keys(serialized).length > 0 ? serialized : undefined;
  } catch {
    return undefined;
  }
}

function safeGetCanDestroy(stack: ItemStack): string[] | undefined {
  try {
    const values = stack.getCanDestroy();
    return values.length > 0 ? values : undefined;
  } catch {
    return undefined;
  }
}

function safeGetCanPlaceOn(stack: ItemStack): string[] | undefined {
  try {
    const values = stack.getCanPlaceOn();
    return values.length > 0 ? values : undefined;
  } catch {
    return undefined;
  }
}

export function serializeItemStack(stack: ItemStack): SerializedItemStack {
  const dynamicProperties = serializeDynamicProperties(stack);
  const durability = stack.getComponent(ItemComponentTypes.Durability);
  const enchantable = stack.getComponent(ItemComponentTypes.Enchantable);

  return {
    itemId: stack.typeId,
    amount: Math.max(1, Math.floor(stack.amount)),
    nameTag: stack.nameTag,
    lore: stack.getLore(),
    enchantments: enchantable?.getEnchantments().map((entry) => ({ id: entry.type.id, level: entry.level })),
    durability: durability?.damage,
    maxDurability: durability?.maxDurability,
    canDestroy: safeGetCanDestroy(stack),
    canPlaceOn: safeGetCanPlaceOn(stack),
    dynamicProperties,
    lockMode: String(stack.lockMode),
    keepOnDeath: stack.keepOnDeath,
  };
}

function parseLockMode(raw?: string): ItemLockMode | undefined {
  if (!raw) return undefined;
  if (raw === ItemLockMode.inventory) return ItemLockMode.inventory;
  if (raw === ItemLockMode.slot) return ItemLockMode.slot;
  if (raw === ItemLockMode.none) return ItemLockMode.none;
  return undefined;
}

export function deserializeItemStack(data: SerializedItemStack): ItemStack {
  const stack = new ItemStack(data.itemId, Math.max(1, Math.floor(data.amount)));

  if (data.nameTag) {
    try {
      stack.nameTag = data.nameTag;
    } catch {
      // ignore invalid name tag
    }
  }

  if (data.lore && data.lore.length > 0) {
    try {
      stack.setLore(data.lore);
    } catch {
      // ignore invalid lore
    }
  }

  if (data.canDestroy && data.canDestroy.length > 0) {
    try {
      stack.setCanDestroy(data.canDestroy);
    } catch {
      // ignore invalid canDestroy list
    }
  }

  if (data.canPlaceOn && data.canPlaceOn.length > 0) {
    try {
      stack.setCanPlaceOn(data.canPlaceOn);
    } catch {
      // ignore invalid canPlaceOn list
    }
  }

  const lockMode = parseLockMode(data.lockMode);
  if (lockMode !== undefined) {
    try {
      stack.lockMode = lockMode;
    } catch {
      // ignore
    }
  }

  if (typeof data.keepOnDeath === "boolean") {
    try {
      stack.keepOnDeath = data.keepOnDeath;
    } catch {
      // ignore
    }
  }

  const enchantable = stack.getComponent(ItemComponentTypes.Enchantable);
  if (enchantable && data.enchantments && data.enchantments.length > 0) {
    try {
      const entries = data.enchantments
        .map((entry) => {
          const type = EnchantmentTypes.get(entry.id);
          if (!type) return undefined;
          return { type, level: Math.max(1, Math.floor(entry.level)) };
        })
        .filter((entry): entry is { type: any; level: number } => Boolean(entry));
      if (entries.length > 0) {
        enchantable.addEnchantments(entries);
      }
    } catch {
      // ignore enchant errors
    }
  }

  const durability = stack.getComponent(ItemComponentTypes.Durability);
  if (durability && data.durability !== undefined) {
    try {
      const max = data.maxDurability ?? durability.maxDurability;
      durability.damage = Math.max(0, Math.min(max, Math.floor(data.durability)));
    } catch {
      // ignore invalid durability
    }
  }

  if (data.dynamicProperties && Object.keys(data.dynamicProperties).length > 0) {
    try {
      const mapped: Record<string, boolean | number | string | Vector3 | undefined> = {};
      for (const [key, value] of Object.entries(data.dynamicProperties)) {
        mapped[key] = toRuntimeDynamicValue(value);
      }
      stack.setDynamicProperties(mapped);
    } catch {
      // ignore dynamic-property failures
    }
  }

  return stack;
}
