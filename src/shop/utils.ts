import { EntityComponentTypes, ItemStack, Player, EnchantmentTypes } from "@minecraft/server";
import { TauUi } from "../ui";
import { type ShopItemDefinition, type ShopItemStackDefinition, type ShopKitDraft, type ShopProfile, type ShopSortMode } from "../types";
import { getInventoryContainer, normalizeCategory, getProfileCategories, saveShops } from "../storage";
import { getItemCanDestroyComponent, getItemCanPlaceOnComponent, getItemDurabilityComponent, getItemEnchantableComponent } from "../shared/item-components";

export function iconForShopItem(item: ShopProfile["items"][number]): string | undefined {
  if (item.displayName && item.displayName.trim().length > 0) return undefined;
  return item.itemId?.trim() || undefined;
}

export function shopLabel(item: ShopItemDefinition): string {
  return item.label?.trim() || item.itemId;
}

export function shopItemKey(item: ShopItemDefinition): string {
  return item.id?.trim() || `${item.itemId}::${item.label?.trim() || item.displayName?.trim() || ""}::${item.category?.trim() || ""}`;
}

export function ensureShopItemId(item: ShopItemDefinition, profileId: string, index: number): string {
  if (item.id && item.id.trim().length > 0) return item.id;
  const generated = `${profileId}:${index}:${item.itemId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_");
  item.id = generated;
  return generated;
}

export function getShopItemByKey(profile: ShopProfile, key: string): ShopItemDefinition | undefined {
  return profile.items.find((item, index) => ensureShopItemId(item, profile.id, index) === key);
}

export function normalizeItemId(value: string): string {
  const trimmed = String(value ?? "").trim().toLowerCase();
  return trimmed.startsWith("minecraft:") ? trimmed.slice(10) : trimmed;
}

export function splitList(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(/[\n|]/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function parseEnchantments(raw: string | undefined): { id: string; level: number }[] {
  const entries = String(raw ?? "")
    .split(/[,\n;]/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const result: { id: string; level: number }[] = [];
  for (const entry of entries) {
    const [idRaw, levelRaw] = entry.split("=", 2);
    const id = String(idRaw ?? "").trim();
    const level = Math.max(1, Math.floor(Number(String(levelRaw ?? "1").trim())));
    if (!id) continue;
    result.push({ id, level });
  }
  return result;
}

export function formatEnchantments(enchantments?: { id: string; level: number }[]): string {
  return (enchantments ?? []).map((entry) => `${entry.id}=${entry.level}`).join(", ");
}

export function normalizeItemStackDefinition(def: Partial<ShopItemStackDefinition> & { itemId: string; amount: number }): ShopItemStackDefinition {
  return {
    itemId: def.itemId.trim(),
    amount: Math.max(1, Math.floor(def.amount)),
    label: def.label?.trim() || undefined,
    displayName: def.displayName?.trim() || undefined,
    lore: def.lore?.map((line) => line.trim()).filter((line) => line.length > 0),
    enchantments: def.enchantments?.filter((entry) => entry.id.trim().length > 0 && entry.level > 0),
    durability: def.durability,
    maxDurability: def.maxDurability,
    exactDurability: def.exactDurability,
    customData: def.customData,
  };
}

export function parseItemStackDefinitionLine(raw: string): ShopItemStackDefinition | undefined {
  const parts = raw.split("|").map((part) => part.trim());
  const itemId = parts[0] ?? "";
  if (!itemId) return undefined;
  const amount = Math.max(1, Math.floor(Number(parts[1] ?? "1")));
  const label = parts[2] || undefined;
  const lore = splitList(parts[3]);
  const enchantments = parseEnchantments(parts[4]);
  return normalizeItemStackDefinition({ itemId, amount, label, displayName: label, lore, enchantments });
}

export function formatItemStackDefinitionLine(def: ShopItemStackDefinition): string {
  return [
    def.itemId,
    String(def.amount),
    def.label ?? def.displayName ?? "",
    (def.lore ?? []).join("\n"),
    formatEnchantments(def.enchantments),
  ].join("|");
}

export function getItemLore(stack: ItemStack): string[] {
  return stack.getLore().map((line) => String(line).trim()).filter((line) => line.length > 0);
}

export function isProtectedCrateKey(stack: ItemStack): boolean {
  for (const line of getItemLore(stack)) {
    if (line.startsWith("§0[TAU_CRATE:")) return true;
  }
  return false;
}

export function getItemEnchantments(stack: ItemStack): { id: string; level: number }[] {
  const component = getItemEnchantableComponent(stack);
  const enchantments = component?.getEnchantments() ?? [];
  return enchantments
    .map((entry) => ({ id: entry.type?.id ?? entry.typeId ?? "", level: entry.level }))
    .filter((entry) => entry.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getEnchantmentPreviewText(enchantments?: { id: string; level: number }[]): string {
  return (enchantments ?? [])
    .map((entry) => `${entry.id} ${entry.level}`)
    .join(", ");
}

export function createStackFromDefinition(def: ShopItemStackDefinition, multiplier = 1): ItemStack {
  const amount = Math.max(1, Math.floor(def.amount * multiplier));
  const stack = new ItemStack(def.itemId, amount);
  if (def.displayName) stack.nameTag = def.displayName;
  if (def.lore && def.lore.length > 0) stack.setLore(def.lore);
  const component = getItemEnchantableComponent(stack);
  if (component && def.enchantments && def.enchantments.length > 0) {
    const valid: { type: any; level: number }[] = [];
    let needsFallback = false;
    for (const entry of def.enchantments) {
      const type = EnchantmentTypes.get(entry.id);
      if (type) {
        const level = Math.max(1, Math.floor(entry.level));
        valid.push({ type, level });
        if (level > type.maxLevel) needsFallback = true;
      }
    }
    if (valid.length > 0 && component.addEnchantments) {
      try {
        component.addEnchantments(valid);
      } catch {
        // Ignore incompatible enchantments
        needsFallback = true;
      }
    }
    if (needsFallback) {
      stack.setDynamicProperty("tau:enchants", JSON.stringify(def.enchantments));
    }
  }
  if (def.durability !== undefined && def.maxDurability !== undefined) {
    const durComp = getItemDurabilityComponent(stack);
    if (durComp) {
      try {
        durComp.damage = Math.max(0, Math.min(def.maxDurability, def.durability));
      } catch {
        // Durability not supported for this item type
      }
    }
  }
  if (def.customData) {
    try {
      const data = JSON.parse(def.customData);
      if (data.canPlaceOn) {
        const placeComp = getItemCanPlaceOnComponent(stack);
        if (placeComp) placeComp.blocks = data.canPlaceOn;
      }
      if (data.canDestroy) {
        const destroyComp = getItemCanDestroyComponent(stack);
        if (destroyComp) destroyComp.blocks = data.canDestroy;
      }
    } catch {
      // Invalid custom data, skip
    }
  }
  return stack;
}

export function purchaseStacksAreSingle(def: ShopItemDefinition): boolean {
  const itemId = normalizeItemId(def.itemId);
  return itemId === "enchanted_book" || (def.enchantments?.length ?? 0) > 0;
}

export function getMaxStackAmount(itemId: string): number {
  try {
    return Math.max(1, new ItemStack(itemId, 1).maxAmount);
  } catch {
    return 64;
  }
}

export function buildChunkedStacks(def: ShopItemStackDefinition, totalAmount: number): ItemStack[] {
  const stacks: ItemStack[] = [];
  const maxAmount = getMaxStackAmount(def.itemId);
  let remaining = Math.max(1, Math.floor(totalAmount));

  while (remaining > 0) {
    const amount = Math.min(maxAmount, remaining);
    stacks.push(createStackFromDefinition({ ...def, amount }, 1));
    remaining -= amount;
  }

  return stacks;
}

function normalizeEnchantmentId(id: string): string {
  const trimmed = String(id ?? "").trim().toLowerCase();
  return trimmed.startsWith("minecraft:") ? trimmed.slice(10) : trimmed;
}

function enchantmentListsEqual(
  expected: { id: string; level: number }[] | undefined,
  actual: { id: string; level: number }[]
): boolean {
  if (!expected || expected.length === 0) return true;
  const normalize = (entries: { id: string; level: number }[]) =>
    entries
      .map((entry) => ({ id: normalizeEnchantmentId(entry.id), level: Math.max(1, Math.floor(entry.level)) }))
      .filter((entry) => entry.id.length > 0)
      .sort((a, b) => a.id.localeCompare(b.id) || a.level - b.level);

  const left = normalize(expected);
  const right = normalize(actual);
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index].id !== right[index].id || left[index].level !== right[index].level) return false;
  }
  return true;
}

function loreListsEqual(expected: string[] | undefined, stack: ItemStack): boolean {
  if (!expected || expected.length === 0) return true;
  const actual = getItemLore(stack);
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index++) {
    if (actual[index] !== expected[index].trim()) return false;
  }
  return true;
}

function getStackEnchantmentsForMatch(stack: ItemStack): { id: string; level: number }[] {
  const fromComponent = getItemEnchantments(stack);
  if (fromComponent.length > 0) return fromComponent;

  const raw = stack.getDynamicProperty("tau:enchants");
  if (typeof raw !== "string" || raw.trim().length === 0) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: { id: string; level: number }[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const id = String((entry as { id?: string }).id ?? "").trim();
      const level = Math.max(1, Math.floor(Number((entry as { level?: number }).level ?? 1)));
      if (!id) continue;
      result.push({ id, level });
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export function itemMatchesDefinition(stack: ItemStack, def: ShopItemStackDefinition): boolean {
  if (isProtectedCrateKey(stack)) return false;
  if (normalizeItemId(stack.typeId) !== normalizeItemId(def.itemId)) return false;

  if (!def.exactDurability) return true;

  const displayName = def.displayName?.trim();
  if (displayName) {
    const tag = stack.nameTag?.trim() ?? "";
    if (tag !== displayName) return false;
  }

  if (!loreListsEqual(def.lore, stack)) return false;

  if (!enchantmentListsEqual(def.enchantments, getStackEnchantmentsForMatch(stack))) return false;

  if (def.durability !== undefined) {
    const durComp = getItemDurabilityComponent(stack);
    if (!durComp || durComp.damage !== def.durability) return false;
    if (def.maxDurability !== undefined && durComp.maxDurability !== def.maxDurability) return false;
  }

  return true;
}

export function countMatchingItems(player: Player, def: ShopItemStackDefinition): number {
  const container = getInventoryContainer(player);
  if (!container) return 0;
  let total = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (!stack || !itemMatchesDefinition(stack, def)) continue;
    total += stack.amount;
  }
  return total;
}

export function removeMatchingItems(player: Player, def: ShopItemStackDefinition, amount: number): boolean {
  const container = getInventoryContainer(player);
  if (!container) return false;
  let remaining = amount;
  for (let slot = 0; slot < container.size && remaining > 0; slot++) {
    const stack = container.getItem(slot);
    if (!stack || !itemMatchesDefinition(stack, def)) continue;
    if (stack.amount <= remaining) {
      remaining -= stack.amount;
      container.setItem(slot, undefined);
    } else {
      stack.amount -= remaining;
      remaining = 0;
      container.setItem(slot, stack);
    }
  }
  return remaining === 0;
}

export function itemRequiresKitMode(item: ShopItemDefinition): boolean {
  return (item.bundle?.length ?? 0) > 0;
}

export function singleStackDefinitionFromItem(item: ShopItemDefinition): ShopItemStackDefinition {
  return normalizeItemStackDefinition({
    itemId: item.itemId,
    amount: 1,
    label: item.label,
    displayName: item.displayName,
    lore: item.lore,
    enchantments: item.enchantments,
  });
}

export function buildItemStacksForPurchase(item: ShopItemDefinition, quantity: number): ItemStack[] {
  if (itemRequiresKitMode(item)) {
    const stacks: ItemStack[] = [];
    for (const entry of item.bundle ?? []) {
      stacks.push(...buildChunkedStacks(entry, entry.amount * quantity));
    }
    return stacks;
  }

  if (purchaseStacksAreSingle(item)) {
    const stacks: ItemStack[] = [];
    for (let index = 0; index < quantity; index++) {
      stacks.push(
        createStackFromDefinition(
          {
            itemId: item.itemId,
            amount: 1,
            label: item.label,
            displayName: item.displayName,
            lore: item.lore,
            enchantments: item.enchantments,
            durability: item.durability,
            maxDurability: item.maxDurability,
            customData: item.customData,
          },
          1
        )
      );
    }
    return stacks;
  }

  return buildChunkedStacks(
    {
      itemId: item.itemId,
      amount: 1,
      label: item.label,
      displayName: item.displayName,
      lore: item.lore,
      enchantments: item.enchantments,
      durability: item.durability,
      maxDurability: item.maxDurability,
      customData: item.customData,
    },
    quantity
  );
}

export function captureHeldItemDefinition(held: ItemStack, amount: number): ShopItemStackDefinition {
  const durComp = getItemDurabilityComponent(held);
  return normalizeItemStackDefinition({
    itemId: held.typeId,
    amount,
    label: held.typeId,
    displayName: held.nameTag?.trim() || undefined,
    lore: getItemLore(held),
    enchantments: getItemEnchantments(held),
    durability: durComp?.damage,
    maxDurability: durComp?.maxDurability,
  });
}

type InventorySnapshot = (ItemStack | undefined)[];

export function snapshotContainer(container: NonNullable<ReturnType<typeof getInventoryContainer>>): InventorySnapshot {
  const snapshot: InventorySnapshot = [];
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    snapshot.push(stack ? stack.clone() : undefined);
  }
  return snapshot;
}

export function restoreContainer(container: NonNullable<ReturnType<typeof getInventoryContainer>>, snapshot: InventorySnapshot) {
  for (let slot = 0; slot < snapshot.length; slot++) {
    container.setItem(slot, snapshot[slot]?.clone());
  }
}

export function getItemInstanceDefinition(item: ShopItemDefinition): ShopItemStackDefinition {
  return normalizeItemStackDefinition({
    itemId: item.itemId,
    amount: 1,
    displayName: item.displayName,
    lore: item.lore,
    enchantments: item.enchantments,
    durability: item.exactDurability ? item.durability : undefined,
    maxDurability: item.exactDurability ? item.maxDurability : undefined,
    exactDurability: item.exactDurability,
  });
}

export function getItemInstanceCount(player: Player, item: ShopItemDefinition): number {
  return countMatchingItems(player, getItemInstanceDefinition(item));
}

export function removeItemInstance(player: Player, item: ShopItemDefinition, quantity: number): boolean {
  if (quantity <= 0) return true;
  return removeMatchingItems(player, getItemInstanceDefinition(item), quantity);
}

export function promptHeldItemPricing(player: Player, held: ItemStack, preset?: Partial<ShopProfile["items"][number]>) {
  return TauUi.modal(`Use Held Item: ${held.typeId}`)
    .text("label", "Shop label", { placeholder: held.typeId, defaultValue: preset?.label ?? held.typeId })
    .text("displayName", "Display name (optional)", { placeholder: "Shown on item", defaultValue: preset?.displayName ?? held.nameTag ?? "" })
    .text("category", "Category", { placeholder: "Tools", defaultValue: preset?.category ?? "" })
    .text("amount", "Amount to use", { placeholder: "1", defaultValue: String(preset?.quantities?.[0] ?? Math.max(1, held.amount)) })
    .toggle("canBuy", "Can be bought", (preset?.buyPrice ?? 0) > 0)
    .text("buyPrice", "Buy price", { placeholder: "0", defaultValue: String(preset?.buyPrice ?? 0) })
    .toggle("canSell", "Can be sold", (preset?.sellPrice ?? 0) > 0)
    .text("sellPrice", "Sell price", { placeholder: "0", defaultValue: String(preset?.sellPrice ?? 0) })
    .text("quantities", "Extra quantities (comma-separated)", { placeholder: "1,16,64", defaultValue: preset?.quantities?.join(",") ?? "1,16,64" })
    .submitButton("Save");
}

export function categoryList(profile: ShopProfile): string[] {
  const categories = new Set<string>();
  for (const item of profile.items) categories.add(normalizeCategory(item.category));
  for (const cat of getProfileCategories(profile.id)) categories.add(normalizeCategory(cat));
  return [...categories].sort();
}

export function itemsInCategory(profile: ShopProfile, category: string) {
  let items = profile.items.filter((item) => normalizeCategory(item.category) === category);
  const sortMode = profile.sortMode ?? "default";
  items = sortShopItems(items, sortMode);
  return items;
}

export function sortShopItems(items: ShopItemDefinition[], mode: ShopSortMode): ShopItemDefinition[] {
  const sorted = [...items];
  switch (mode) {
    case "name":
      sorted.sort((a, b) => (a.displayName || a.itemId).localeCompare(b.displayName || b.itemId));
      break;
    case "buyPrice":
      sorted.sort((a, b) => a.buyPrice - b.buyPrice);
      break;
    case "sellPrice":
      sorted.sort((a, b) => a.sellPrice - b.sellPrice);
      break;
    case "category":
      sorted.sort((a, b) => normalizeCategory(a.category).localeCompare(normalizeCategory(b.category)));
      break;
    default:
      break;
  }
  return sorted;
}

export function normalizeShopProfileItems(profile: ShopProfile): void {
  let changed = false;
  profile.items.forEach((item, index) => {
    if (!item.id || item.id.trim().length === 0) {
      ensureShopItemId(item, profile.id, index);
      changed = true;
    }
  });
  if (changed) saveShops();
}

export function getHeldItem(player: Player): ItemStack | undefined {
  const inv = player.getComponent(EntityComponentTypes.Inventory);
  return inv?.container?.getItem(player.selectedSlotIndex);
}
