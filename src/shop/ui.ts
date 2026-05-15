import { EntityComponentTypes, ItemComponentTypes, ItemStack, Player, EnchantmentTypes } from "@minecraft/server";
import { TauUi } from "../ui";
import { canonicalShopId, findShopProfile, getInventoryContainer, getScore, normalizeCategory, getProfileCategories, setScore, state, saveShops, tell } from "../storage";
import { type ShopItemDefinition, type ShopItemStackDefinition, type ShopKitDraft, type ShopProfile, type ShopSortMode } from "../types";
import {
  iconForShopItem,
  shopLabel,
  shopItemKey,
  ensureShopItemId,
  getShopItemByKey,
  normalizeItemId,
  splitList,
  parseEnchantments,
  formatEnchantments,
  normalizeItemStackDefinition,
  parseItemStackDefinitionLine,
  formatItemStackDefinitionLine,
  getItemLore,
  isProtectedCrateKey,
  getItemEnchantments,
  getEnchantmentPreviewText,
  createStackFromDefinition,
  purchaseStacksAreSingle,
  getMaxStackAmount,
  buildChunkedStacks,
  buildItemStacksForPurchase,
  itemRequiresKitMode,
  itemMatchesDefinition,
  countMatchingItems,
  removeMatchingItems,
  getItemInstanceDefinition,
  getItemInstanceCount,
  removeItemInstance,
  snapshotContainer,
  restoreContainer,
  getHeldItem,
  captureHeldItemDefinition,
  singleStackDefinitionFromItem,
  normalizeShopProfileItems,
  sortShopItems,
  itemsInCategory,
  categoryList,
  promptHeldItemPricing,
} from "./utils";
import { ICONS } from "../ui/icons";

type SellAllSlotPlan = {
  slot: number;
  amount: number;
};

type SellAllPlanEntry = {
  item: ShopItemDefinition;
  owned: number;
  total: number;
  slots: SellAllSlotPlan[];
};

export async function openShopProfile(player: Player, profileId: string) {
  await showShopFront(player, canonicalShopId(profileId));
}

export async function openShopEditor(player: Player, profileId: string) {
  await showShopItemEditor(player, canonicalShopId(profileId));
}

function moveCategoryItems(profile: ShopProfile, sourceCategory: string, targetProfile: ShopProfile, targetCategory?: string): void {
  const nextCategory = targetCategory?.trim() || sourceCategory;
  const movingItems: ShopItemDefinition[] = [];
  profile.items = profile.items.filter((item) => {
    if (normalizeCategory(item.category) !== sourceCategory) return true;
    item.category = nextCategory;
    movingItems.push(item);
    return false;
  });
  for (const item of movingItems) {
    ensureShopItemId(item, targetProfile.id, targetProfile.items.length);
    targetProfile.items.push(item);
  }
  profile.categories = (profile.categories ?? []).filter((entry) => entry !== sourceCategory);
  targetProfile.categories ??= [];
  if (!targetProfile.categories.includes(nextCategory)) targetProfile.categories.push(nextCategory);
  saveShops();
}

function buildSellAllPlan(player: Player, profile: ShopProfile): { entries: SellAllPlanEntry[]; totalGain: number } {
  const container = getInventoryContainer(player);
  if (!container) return { entries: [], totalGain: 0 };

  const availableByItemId = new Map<string, SellAllSlotPlan[]>();
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (!stack || isProtectedCrateKey(stack)) continue;
    const itemId = normalizeItemId(stack.typeId);
    const slots = availableByItemId.get(itemId) ?? [];
    slots.push({ slot, amount: stack.amount });
    availableByItemId.set(itemId, slots);
  }

  const entries: SellAllPlanEntry[] = [];
  let totalGain = 0;
  for (const item of profile.items) {
    if (item.bundle && item.bundle.length > 0) continue;
    if (item.canSell === false || item.sellPrice <= 0) continue;
    const availableSlots = availableByItemId.get(normalizeItemId(item.itemId));
    if (!availableSlots || availableSlots.length === 0) continue;

    let owned = 0;
    const slots: SellAllSlotPlan[] = [];
    for (const slotPlan of availableSlots) {
      if (slotPlan.amount <= 0) continue;
      const stack = container.getItem(slotPlan.slot);
      if (!stack || !itemMatchesDefinition(stack, getItemInstanceDefinition(item))) continue;
      owned += slotPlan.amount;
      slots.push({ slot: slotPlan.slot, amount: slotPlan.amount });
      slotPlan.amount = 0;
    }
    if (owned <= 0) continue;

    const total = item.sellPrice * owned;
    totalGain += total;
    entries.push({ item, owned, total, slots });
  }

  return { entries, totalGain };
}

function applySellAllPlan(player: Player, entries: SellAllPlanEntry[]): boolean {
  const container = getInventoryContainer(player);
  if (!container) return false;
  for (const entry of entries) {
    for (const plan of entry.slots) {
      let remaining = plan.amount;
      const stack = container.getItem(plan.slot);
      if (!stack || !itemMatchesDefinition(stack, getItemInstanceDefinition(entry.item))) return false;
      if (stack.amount < remaining) return false;
      if (stack.amount === remaining) {
        container.setItem(plan.slot, undefined);
      } else {
        stack.amount -= remaining;
        remaining = 0;
        container.setItem(plan.slot, stack);
      }
      if (remaining !== 0) return false;
    }
  }
  return true;
}

async function moveCategoryToProfile(player: Player, sourceProfile: ShopProfile, category: string): Promise<void> {
  const profiles = Object.values(state.shops).filter((profile) => profile.id !== sourceProfile.id).sort((a, b) => a.id.localeCompare(b.id));
  const menu = TauUi.action(`Move Category: ${category}`)
    .body("Choose a destination profile.")
    .button("createProfile", "Create new profile", { iconPath: ICONS.confirm });

  for (const profile of profiles) menu.button(profile.id, profile.id, { iconPath: ICONS.shop });
  menu.button("cancel", "Cancel", { iconPath: ICONS.back });

  const response = await menu.show(player);
  if (response.canceled || response.id === "cancel") return;

  if (response.id === "createProfile") {
    const modal = TauUi.modal("New Shop Profile")
      .text("profileId", "Profile ID", { placeholder: "gens" })
      .text("currencyObjective", "Currency objective", { placeholder: sourceProfile.currencyObjective, defaultValue: sourceProfile.currencyObjective })
      .text("destinationCategory", "Destination category name", { placeholder: category, defaultValue: category })
      .submitButton("Create and Move");
    const result = await modal.show(player);
    if (result.canceled) return;

    const profileId = String(result.values.profileId ?? "").trim();
    const objective = String(result.values.currencyObjective ?? "").trim() || sourceProfile.currencyObjective;
    const destinationCategory = String(result.values.destinationCategory ?? "").trim() || category;
    if (!profileId) {
      tell(player, "Profile ID is required.");
      return;
    }

    const targetProfile: ShopProfile = state.shops[profileId] ?? {
      id: profileId,
      currencyObjective: objective,
      categories: [],
      items: [],
    };
    targetProfile.currencyObjective = objective;
    state.shops[profileId] = targetProfile;
    moveCategoryItems(sourceProfile, category, targetProfile, destinationCategory);
    tell(player, `Moved category ${category} to ${profileId}.`);
    return;
  }

  const targetProfile = profiles.find((p) => p.id === response.id);
  if (!targetProfile) return;
  const modal = TauUi.modal("Move Category")
    .text("destinationCategory", "Destination category name", { placeholder: category, defaultValue: category })
    .submitButton("Move");
  const result = await modal.show(player);
  if (result.canceled) return;

  const destinationCategory = String(result.values.destinationCategory ?? "").trim() || category;
  moveCategoryItems(sourceProfile, category, targetProfile, destinationCategory);
  tell(player, `Moved category ${category} to ${targetProfile.id}.`);
}

async function showCategoryManager(player: Player, profile: ShopProfile) {
  while (true) {
    const categories = categoryList(profile);
    const menu = TauUi.action(`Categories: ${profile.id}`)
      .body(`Count: ${categories.length}`)
      .button("addCategory", "Add category", { iconPath: ICONS.confirm });

    for (const category of categories) menu.button(category, category, { iconPath: ICONS.menu });
    menu.button("back", "Back", { iconPath: ICONS.back });

    const response = await menu.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "addCategory") {
      const modal = TauUi.modal("Add Category")
        .text("name", "Name", { placeholder: "Tools" })
        .submitButton("Save");
      const result = await modal.show(player);
      if (result.canceled) continue;
      const name = String(result.values.name ?? "").trim();
      if (!name) continue;
      profile.categories ??= [];
      if (!profile.categories.includes(name)) profile.categories.push(name);
      saveShops();
      tell(player, `Added category ${name}.`);
      continue;
    }

    if (categories.includes(response.id)) {
      await showCategoryEditor(player, profile, response.id);
      continue;
    }

    return;
  }
}

async function showCategoryEditor(player: Player, profile: ShopProfile, category: string) {
  while (true) {
    const items = itemsInCategory(profile, category);
    const menu = TauUi.action<{ index: number }>(`${profile.id} / ${category}`)
      .body(`Items: ${items.length}`)
      .button("rename", "Rename category", { iconPath: ICONS.edit })
      .button("move", "Move category", { iconPath: ICONS.shop })
      .button("delete", "Delete category", { iconPath: ICONS.delete })
      .button("addHeldItem", "Add held item", { iconPath: ICONS.binding })
      .button("addItem", "Add item", { iconPath: ICONS.confirm });

    for (const item of items) menu.button(`item:${shopItemKey(item)}`, `${shopLabel(item)} (${item.buyPrice}/${item.sellPrice})`, { iconPath: iconForShopItem(item), value: { index: profile.items.indexOf(items[items.indexOf(item)]) } });
    menu.button("back", "Back", { iconPath: ICONS.back });

    const response = await menu.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "rename") {
      const modal = TauUi.modal("Rename Category")
        .text("name", "Name", { placeholder: category, defaultValue: category })
        .submitButton("Save");
      const result = await modal.show(player);
      if (result.canceled) continue;
      const nextName = String(result.values.name ?? "").trim();
      if (!nextName) continue;
      for (const item of profile.items) {
        if (normalizeCategory(item.category) === category) item.category = nextName;
      }
      profile.categories = (profile.categories ?? []).filter((c) => c !== category);
      if (!profile.categories.includes(nextName)) profile.categories.push(nextName);
      saveShops();
      tell(player, `Renamed category to ${nextName}.`);
      category = nextName;
      continue;
    }

    if (response.id === "move") {
      await moveCategoryToProfile(player, profile, category);
      return;
    }

    if (response.id === "delete") {
      for (const item of profile.items) {
        if (normalizeCategory(item.category) === category) item.category = undefined;
      }
      profile.categories = (profile.categories ?? []).filter((c) => c !== category);
      saveShops();
      tell(player, `Deleted category ${category}.`);
      return;
    }

    if (response.id === "addHeldItem") {
      await addHeldItemFlow(player, profile, category);
      continue;
    }

    if (response.id === "addItem") {
      await addShopItemFlow(player, profile, category);
      continue;
    }

    if (response.value && typeof response.value === "object" && "index" in response.value) {
      const idx = (response.value as { index: number }).index;
      if (idx >= 0 && idx < profile.items.length) {
        await showShopItemActions(player, profile, idx);
        continue;
      }
    }

    return;
  }
}

async function addShopItemFlow(player: Player, profile: ShopProfile, category?: string) {
  const modal = TauUi.modal("Add Shop Item")
    .text("itemId", "Item ID", { placeholder: "minecraft:iron_ingot" })
    .text("displayName", "Display name (optional)", { placeholder: "Iron Ingot" })
    .text("category", "Category (optional)", { placeholder: category ?? "Tools" })
    .toggle("canBuy", "Can be bought", true)
    .text("buyPrice", "Buy price", { placeholder: "30", defaultValue: "30" })
    .toggle("canSell", "Can be sold", true)
    .text("sellPrice", "Sell price", { placeholder: "15", defaultValue: "15" })
    .text("quantities", "Quantities (comma-separated)", { placeholder: "1,16,64", defaultValue: "1,16,64" })
    .submitButton("Add");

  const result = await modal.show(player);
  if (result.canceled) return;

  const itemId = String(result.values.itemId ?? "").trim();
  const displayName = String(result.values.displayName ?? "").trim();
  const cat = String(result.values.category ?? "").trim();
  const canBuy = Boolean(result.values.canBuy);
  const buyPrice = Math.max(0, Math.floor(Number(result.values.buyPrice ?? 0)));
  const canSell = Boolean(result.values.canSell);
  const sellPrice = Math.max(0, Math.floor(Number(result.values.sellPrice ?? 0)));
  const quantities = cleanQuantities(String(result.values.quantities ?? "1"));

  if (!itemId) {
    tell(player, "Item ID is required.");
    return;
  }

  profile.items.push({
    itemId,
    displayName: displayName || undefined,
    category: cat || category || undefined,
    buyPrice: canBuy ? buyPrice : 0,
    canBuy,
    sellPrice: canSell ? sellPrice : 0,
    canSell,
    quantities: quantities.length > 0 ? quantities : [1],
  });
  saveShops();
  tell(player, `Added ${itemId}.`);
}

async function addHeldItemFlow(player: Player, profile: ShopProfile, category?: string) {
  const held = getHeldItem(player);
  if (!held) {
    tell(player, "Hold an item first.");
    return;
  }

  const result = await promptHeldItemPricing(player, held, {
    category,
    quantities: [Math.max(1, held.amount)],
  }).show(player);
  if (result.canceled) return;

  profile.items.push(normalizeHeldShopItemResult(held, result.values, category));
  saveShops();
  tell(player, `Added held item ${held.typeId}.`);
}

function summarizeKitBundle(bundle: ShopItemStackDefinition[]): string {
  if (bundle.length === 0) return "No held items added yet.";
  return bundle
    .map((entry, index) => {
      const name = entry.displayName ?? entry.itemId;
      const suffix = entry.enchantments && entry.enchantments.length > 0 ? ` (${formatEnchantments(entry.enchantments)})` : "";
      return `${index + 1}. ${name} x${entry.amount}${suffix}`;
    })
    .join("\n");
}

function getKitDraft(profile: ShopProfile): ShopKitDraft {
  return profile.kitDraft ?? {
    displayName: "",
    category: "Kits",
    buyPrice: 100,
    quantities: [1],
    bundle: [],
  };
}

function saveKitDraft(profile: ShopProfile, draft: ShopKitDraft) {
  profile.kitDraft = draft;
  saveShops();
}

async function promptKitDetails(player: Player, current: {
  displayName: string;
  category: string;
  buyPrice: number;
  quantities: number[];
}) {
  const modal = TauUi.modal("Kit Details")
    .text("displayName", "Kit name", { placeholder: "PvP Kit", defaultValue: current.displayName })
    .text("category", "Category", { placeholder: "Kits", defaultValue: current.category })
    .text("buyPrice", "Buy price", { placeholder: "100", defaultValue: String(current.buyPrice) })
    .text("quantities", "Quantities", { placeholder: "1", defaultValue: current.quantities.join(",") })
    .submitButton("Save");

  const result = await modal.show(player);
  if (result.canceled) return undefined;

  const displayName = String(result.values.displayName ?? "").trim();
  const category = String(result.values.category ?? "").trim();
  const buyPrice = Math.max(0, Math.floor(Number(result.values.buyPrice ?? 0)));
  const quantities = cleanQuantities(String(result.values.quantities ?? "1"));
  if (!displayName) return undefined;

  return {
    displayName,
    category: category || "Kits",
    buyPrice,
    quantities: quantities.length > 0 ? quantities : [1],
  };
}

async function kitBuilderFlow(player: Player, profile: ShopProfile, existing?: ShopItemDefinition, category?: string) {
  const base = existing
    ? {
        sourceItemId: existing.itemId,
        displayName: existing.displayName ?? "",
        category: existing.category ?? category ?? "Kits",
        buyPrice: existing.buyPrice ?? 100,
        quantities: existing.quantities ?? [1],
        bundle: [...(existing.bundle ?? [])],
      }
    : getKitDraft(profile);

  const draft: ShopKitDraft = {
    sourceItemId: base.sourceItemId,
    displayName: base.displayName,
    category: base.category,
    buyPrice: base.buyPrice,
    quantities: base.quantities,
    bundle: [...base.bundle],
  };
  const draftFlags = {
    canBuy: existing ? existing.buyPrice > 0 : true,
    canSell: existing ? existing.sellPrice > 0 : false,
  };

  while (true) {
    const menu = TauUi.action(existing ? `Edit Kit: ${draft.displayName || existing.itemId}` : "Add Kit")
      .body(
        [
          `Items: ${draft.bundle.length}`,
          `Name: ${draft.displayName || "(set name)"}`,
          `Category: ${draft.category || "Kits"}`,
          `Buy price: ${draft.buyPrice}`,
          `Can buy: ${draftFlags.canBuy ? "Yes" : "No"}`,
          `Can sell: ${draftFlags.canSell ? "Yes" : "No"}`,
          `Qty options: ${draft.quantities.join(", ")}`,
          "Add held items, then submit.",
          summarizeKitBundle(draft.bundle),
        ].join("\n")
      )
      .button("addHeldItem", "Add held item", { iconPath: ICONS.binding })
      .button("editDetails", "Edit details", { iconPath: ICONS.edit })
      .button("toggleBuySell", "Toggle buy/sell", { iconPath: ICONS.settings })
      .button("removeLast", "Remove last", { iconPath: ICONS.delete })
      .button("clearItems", "Clear items", { iconPath: ICONS.cancel })
      .button("submit", "Submit", { iconPath: ICONS.confirm })
      .button("cancel", "Cancel", { iconPath: ICONS.back });

    const response = await menu.show(player);
    if (response.canceled || response.id === "cancel") return;

    if (response.id === "addHeldItem") {
      const held = getHeldItem(player);
      if (!held) {
        tell(player, "Hold an item first.");
        continue;
      }
      draft.bundle.push(captureHeldItemDefinition(held, Math.max(1, held.amount)));
      saveKitDraft(profile, draft);
      tell(player, `Added held item ${held.nameTag?.trim() || held.typeId}.`);
      continue;
    }

    if (response.id === "editDetails") {
      const details = await promptKitDetails(player, draft);
      if (!details) continue;
      draft.displayName = details.displayName;
      draft.category = details.category;
      draft.buyPrice = details.buyPrice;
      draft.quantities = details.quantities;
      saveKitDraft(profile, draft);
      continue;
    }

    if (response.id === "toggleBuySell") {
      draftFlags.canBuy = !draftFlags.canBuy;
      draftFlags.canSell = !draftFlags.canSell;
      continue;
    }

    if (response.id === "removeLast") {
      if (draft.bundle.length === 0) continue;
      draft.bundle.pop();
      saveKitDraft(profile, draft);
      continue;
    }

    if (response.id === "clearItems") {
      draft.bundle = [];
      saveKitDraft(profile, draft);
      continue;
    }

    if (response.id === "submit") {
      if (!draft.displayName.trim()) {
        tell(player, "Kit name is required.");
        continue;
      }
      if (draft.bundle.length === 0) {
        tell(player, "Add at least one held item first.");
        continue;
      }

      const itemId = existing?.itemId ?? `kit:${draft.displayName.toLowerCase().replace(/\s+/g, "_")}`;
      const nextItem: ShopItemDefinition = {
        ...existing,
        itemId,
        displayName: draft.displayName,
        category: draft.category || "Kits",
        buyPrice: draft.buyPrice,
        sellPrice: 0,
        canBuy: draftFlags.canBuy,
        canSell: draftFlags.canSell,
        quantities: draft.quantities,
        bundle: draft.bundle,
      };

      if (existing) {
        const existingKey = shopItemKey(existing);
        const index = profile.items.findIndex((item) => shopItemKey(item) === existingKey);
        if (index >= 0) profile.items[index] = nextItem;
      } else {
        profile.items.push(nextItem);
      }

      delete profile.kitDraft;

      saveShops();
      tell(player, `${existing ? "Saved" : "Added"} kit ${draft.displayName}.`);
      return;
    }

    return;
  }
}

async function addKitItemFlow(player: Player, profile: ShopProfile, category?: string) {
  const draft = getKitDraft(profile);
  draft.category = category ?? draft.category;
  profile.kitDraft = draft;
  saveShops();
  await kitBuilderFlow(player, profile, undefined, category);
}

async function editKitItemFlow(player: Player, profile: ShopProfile, itemIndex: number) {
  const item = profile.items[itemIndex];
  if (!item || !item.bundle || item.bundle.length === 0) return;
  profile.kitDraft = {
    sourceItemId: item.itemId,
    displayName: item.displayName ?? "",
    category: item.category ?? "Kits",
    buyPrice: item.buyPrice,
    quantities: item.quantities,
    bundle: [...item.bundle],
  };
  profile.kitDraft = profile.kitDraft;
  saveShops();
  await kitBuilderFlow(player, profile, item, item.category);
}

function cleanQuantities(raw: string): number[] {
  return raw
    .split(",")
    .map((v) => Math.max(1, Math.floor(Number(v.trim()))))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);
}

function normalizeHeldShopItemResult(
  held: ItemStack,
  values: Record<string, string | number | boolean | undefined>,
  fallbackCategory?: string
) {
  const label = String(values.label ?? "").trim();
  const displayName = String(values.displayName ?? "").trim();
  const category = String(values.category ?? "").trim();
  const amount = Math.max(1, Math.floor(Number(values.amount ?? held.amount ?? 1)));
  const canBuy = Boolean(values.canBuy);
  const buyPrice = Math.max(0, Math.floor(Number(values.buyPrice ?? 0)));
  const canSell = Boolean(values.canSell);
  const sellPrice = Math.max(0, Math.floor(Number(values.sellPrice ?? 0)));
  const extras = cleanQuantities(String(values.quantities ?? ""));

  return {
    itemId: held.typeId,
    label: label || held.typeId,
    displayName: displayName || undefined,
    category: category || fallbackCategory || undefined,
    buyPrice: canBuy ? buyPrice : 0,
    canBuy,
    sellPrice: canSell ? sellPrice : 0,
    canSell,
    quantities: [...new Set([amount, ...extras])].slice(0, 10),
    lore: getItemLore(held),
    enchantments: getItemEnchantments(held),
    exactDurability: false,
  };
}

async function showCategoryItems(
  player: Player,
  profile: ShopProfile,
  category: string
) {
  while (true) {
    const items = itemsInCategory(profile, category);
    const menu = TauUi.action<{ index: number }>(`${profile.id} / ${category}`)
      .body(`Items: ${items.length}`);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      menu.button(`item:${i}`, `${shopLabel(item)} (${item.buyPrice}/${item.sellPrice})`, { iconPath: ICONS.shop, value: { index: i } });
    }
    menu.button("back", "Back", { iconPath: ICONS.back });

    const response = await menu.show(player);
    if (response.canceled || response.id === "back") return;
    if (response.value && typeof response.value === "object" && "index" in response.value) {
      const idx = (response.value as { index: number }).index;
      if (idx >= 0 && idx < items.length) {
        await openShopTransaction(player, `${profile.id}|key:${shopItemKey(items[idx])}`);
      }
    }
  }
}

async function showShopFront(player: Player, profileId: string) {
  const profile = findShopProfile(profileId);
  if (!profile) {
    tell(player, `Shop profile "${profileId}" was not found.`);
    return;
  }
  normalizeShopProfileItems(profile);

  while (true) {
    const categories = categoryList(profile);
    const menu = TauUi.action(`Shop: ${profile.id}`)
      .body(`Currency: ${profile.currencyObjective}\nCategories: ${categories.length}`);

    menu.button("allItems", "All Items", { iconPath: ICONS.shop });
    menu.button("sellAll", "Sell All Sellable", { iconPath: ICONS.sellAll });
    for (const category of categories) menu.button(category, category, { iconPath: ICONS.menu });
    menu.button("back", "Back", { iconPath: ICONS.back });

    const response = await menu.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "allItems") {
      await showCategoryItems(player, profile, "Uncategorized");
      continue;
    }
    if (response.id === "sellAll") {
      await sellAllSellableItems(player, profile.id);
      continue;
    }

    if (categories.includes(response.id)) {
      await showCategoryItems(player, profile, response.id);
      continue;
    }

    return;
  }
}

async function applyHeldItemAsShopItem(player: Player, profile: ShopProfile, itemIndex?: number) {
  const held = getHeldItem(player);
  if (!held) {
    tell(player, "No item held in main hand.");
    return;
  }
  const quantity = held.amount > 0 ? held.amount : 1;
  const targetIndex = itemIndex ?? profile.items.findIndex((item) => normalizeItemId(item.itemId) === normalizeItemId(held.typeId));
  const existing = targetIndex >= 0 ? profile.items[targetIndex] : undefined;
  const lore = held.getLore();

  const newItem: ShopItemDefinition = {
    ...existing,
    itemId: held.typeId,
    displayName: held.nameTag?.trim() || undefined,
    category: existing?.category ?? undefined,
    buyPrice: existing?.buyPrice ?? 30,
    sellPrice: existing?.sellPrice ?? 15,
    canBuy: true,
    canSell: true,
    quantities: existing?.quantities ?? [1, quantity, 64],
    lore: lore.length > 0 ? lore : undefined,
  };

  if (targetIndex >= 0) {
    profile.items[targetIndex] = newItem;
    tell(player, `Updated shop item "${held.typeId}".`);
  } else {
    profile.items.push(newItem);
    tell(player, `Added "${held.typeId}" to shop.`);
  }
  saveShops();
}

async function editShopItem(player: Player, profile: ShopProfile, itemIndex: number) {
  const item = profile.items[itemIndex];
  if (!item) return;
  if (item.bundle && item.bundle.length > 0) {
    const mode = await TauUi.action(`Edit Kit: ${shopLabel(item)}`)
      .body(`Buy enabled: ${item.canBuy !== false}\nSell enabled: ${item.canSell !== false}`)
      .button("toggleBuy", "Toggle buy", { iconPath: ICONS.settings })
      .button("toggleSell", "Toggle sell", { iconPath: ICONS.settings })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (mode.canceled || mode.id === "back") return;
    if (mode.id === "toggleBuy") item.canBuy = !(item.canBuy !== false);
    if (mode.id === "toggleSell") item.canSell = !(item.canSell !== false);
    saveShops();
    return;
  }

  const modal = TauUi.modal(`Edit Item: ${item.itemId}`)
    .text("itemId", "Item ID", { placeholder: "minecraft:iron_ingot", defaultValue: item.itemId })
    .text("label", "Shop label", { placeholder: "Iron Ingot", defaultValue: item.label ?? item.itemId })
    .text("displayName", "Item display name (optional)", { placeholder: "Shown on given item", defaultValue: item.displayName ?? "" })
    .text("category", "Category (optional)", { placeholder: "Tools", defaultValue: item.category ?? "" })
    .toggle("canBuy", "Can be bought", item.canBuy !== false)
    .text("buyPrice", "Buy price", { placeholder: "30", defaultValue: String(item.buyPrice) })
    .toggle("canSell", "Can be sold", item.canSell !== false)
    .text("sellPrice", "Sell price", { placeholder: "15", defaultValue: String(item.sellPrice) })
    .text("quantities", "Quantities (comma-separated)", { placeholder: "1,16,64", defaultValue: item.quantities.join(",") })
    .submitButton("Save");

  const result = await modal.show(player);
  if (result.canceled) return;

  const itemId = String(result.values.itemId ?? "").trim();
  const label = String(result.values.label ?? "").trim();
  const displayName = String(result.values.displayName ?? "").trim();
  const category = String(result.values.category ?? "").trim();
  const canBuy = Boolean(result.values.canBuy);
  const buyPrice = Math.max(0, Math.floor(Number(result.values.buyPrice ?? 0)));
  const canSell = Boolean(result.values.canSell);
  const sellPrice = Math.max(0, Math.floor(Number(result.values.sellPrice ?? 0)));
  const quantities = String(result.values.quantities ?? "1")
    .split(",")
    .map((v) => Math.max(1, Math.floor(Number(v.trim()))))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);

  if (!itemId) {
    tell(player, "Item ID is required.");
    return;
  }

  profile.items[itemIndex] = {
    ...item,
    itemId,
    label: label || itemId,
    displayName: displayName || undefined,
    category: category || undefined,
    buyPrice: canBuy ? buyPrice : 0,
    canBuy,
    sellPrice: canSell ? sellPrice : 0,
    canSell,
    quantities: quantities.length > 0 ? quantities : [1],
  };

  saveShops();
  tell(player, `Updated shop item "${itemId}".`);
}

async function duplicateShopItem(player: Player, profile: ShopProfile, itemIndex: number) {
  const item = profile.items[itemIndex];
  if (!item) return;
  profile.items.push({
    ...item,
    itemId: `${item.itemId}_copy`,
    displayName: item.displayName ? `${item.displayName} Copy` : undefined,
  });
  saveShops();
  tell(player, `Duplicated ${item.itemId}.`);
}

async function moveShopItemToCategory(player: Player, profile: ShopProfile, itemIndex: number) {
  const item = profile.items[itemIndex];
  if (!item) return;
  const categories = categoryList(profile);
  const menu = TauUi.action(`Move: ${shopLabel(item)}`);
  for (const category of categories) menu.button(category, category, { iconPath: ICONS.menu });
  menu.button("newCategory", "New category", { iconPath: ICONS.confirm });
  menu.button("cancel", "Cancel", { iconPath: ICONS.cancel });
  const response = await menu.show(player);
  if (response.canceled || response.id === "cancel") return;
  let target = "";
  if (categories.includes(response.id)) target = response.id;
  else if (response.id === "newCategory") {
    const modal = TauUi.modal("New Category")
      .text("name", "Name", { placeholder: "Tools" })
      .submitButton("Save");
    const result = await modal.show(player);
    if (result.canceled) return;
    target = String(result.values.name ?? "").trim();
  } else return;
  if (!target) return;
  item.category = target;
  saveShops();
  tell(player, `Moved ${item.itemId} to ${target}.`);
}

async function showShopItemActions(player: Player, profile: ShopProfile, itemIndex: number) {
  const item = profile.items[itemIndex];
  if (!item) return;
  while (true) {
    const menu = TauUi.action(shopLabel(item))
      .body(
        [
          `Mode: ${item.bundle && item.bundle.length > 0 ? "kit" : "item"}`,
          `Buy: ${item.buyPrice}`,
          `Sell: ${item.bundle && item.bundle.length > 0 ? "N/A" : item.canSell === false ? "Off" : item.sellPrice}`,
          `Category: ${normalizeCategory(item.category)}`,
          item.durability !== undefined ? `Durability: ${item.durability}/${item.maxDurability ?? "?"}` : "",
          item.exactDurability ? "§aExact durability match" : "",
        ].filter(Boolean).join("\n")
      )
      .button("edit", "Edit", { iconPath: ICONS.edit })
      .button("moveCategory", "Move category", { iconPath: ICONS.menu })
      .button("duplicate", "Duplicate", { iconPath: ICONS.confirm })
      .button("advancedProps", "Advanced Properties", { iconPath: ICONS.settings })
      .button("delete", "Delete", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back });
    const response = await menu.show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "edit") {
      if (item.bundle && item.bundle.length > 0) await editKitItemFlow(player, profile, itemIndex);
      else await editShopItem(player, profile, itemIndex);
      return;
    }
    if (response.id === "moveCategory") {
      await moveShopItemToCategory(player, profile, itemIndex);
      return;
    }
    if (response.id === "duplicate") {
      await duplicateShopItem(player, profile, itemIndex);
      return;
    }
    if (response.id === "advancedProps") {
      await showAdvancedProperties(player, profile, itemIndex);
      continue;
    }
    if (response.id === "delete") {
      profile.items.splice(itemIndex, 1);
      saveShops();
      tell(player, `Deleted ${item.itemId}.`);
      return;
    }
    return;
  }
}

async function showAdvancedProperties(player: Player, profile: ShopProfile, itemIndex: number) {
  const item = profile.items[itemIndex];
  if (!item) return;

  const durComp = item.durability !== undefined;
  const exactLabel = item.exactDurability ? "Enabled" : "Disabled";
  const showLabel = item.showEnchantsInPreview ? "Enabled" : "Disabled";
  const durText = durComp ? `${item.durability}/${item.maxDurability ?? "?"}` : "Not set";

  while (true) {
    const form = TauUi.action("Advanced Properties")
      .body(
        [
          `Durability: ${durText}`,
          `Exact Durability Match: ${exactLabel}`,
          `Show Enchants in Preview: ${showLabel}`,
          `Custom Data: ${item.customData ? "Set" : "None"}`,
        ].join("\n")
      )
      .button("toggleExactDurability", "Toggle Exact Durability", { iconPath: ICONS.settings })
      .button("toggleShowEnchants", "Toggle Show Enchants", { iconPath: ICONS.settings })
      .button("editCustomData", "Edit Custom Data", { iconPath: ICONS.edit })
      .button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "toggleExactDurability") {
      item.exactDurability = !item.exactDurability;
      saveShops();
      continue;
    }
    if (response.id === "toggleShowEnchants") {
      item.showEnchantsInPreview = !item.showEnchantsInPreview;
      saveShops();
      continue;
    }
    if (response.id === "editCustomData") {
      const modal = TauUi.modal("Custom Data (JSON)")
        .text("data", "Data", { placeholder: '{"canPlaceOn": [], "canDestroy": []}', defaultValue: item.customData ?? "" })
        .submitButton("Save");
      const result = await modal.show(player);
      if (result.canceled) continue;
      const data = String(result.values.data ?? "").trim();
      if (data) {
        try {
          JSON.parse(data);
          item.customData = data;
          saveShops();
          tell(player, "Custom data saved.");
        } catch {
          tell(player, "§cInvalid JSON. Please check your input.");
        }
      } else {
        item.customData = undefined;
        saveShops();
        tell(player, "Custom data cleared.");
      }
      continue;
    }
    return;
  }
}

export async function sellAllSellableItems(player: Player, profileId: string) {
  const profile = findShopProfile(profileId);
  if (!profile) {
    tell(player, `Shop profile "${profileId}" was not found.`);
    return;
  }
  normalizeShopProfileItems(profile);

  const current = getScore(player, profile.currencyObjective);
  if (current === undefined) {
    tell(player, `Missing scoreboard objective "${profile.currencyObjective}".`);
    return;
  }

  const plan = buildSellAllPlan(player, profile);
  const sellItems = plan.entries;
  const totalGain = plan.totalGain;

  if (sellItems.length === 0) {
    tell(player, "Nothing sellable was found.");
    return;
  }

  const lines: string[] = [];
  for (const entry of sellItems) {
    let name = shopLabel(entry.item);
    if (entry.item.showEnchantsInPreview && entry.item.enchantments && entry.item.enchantments.length > 0) {
      const enchStr = getEnchantmentPreviewText(entry.item.enchantments);
      name += ` §7(${enchStr})`;
    }
    if (entry.item.lore && entry.item.lore.length > 0) {
      name += ` §7[${entry.item.lore.length} lore]`;
    }
    lines.push(`§e${entry.owned}x ${name}§7 = +${entry.total}`);
  }
  lines.push("");
  lines.push(`§aTotal: +${totalGain} ${profile.currencyObjective}`);

  while (true) {
    const confirmForm = TauUi.action("Sell All")
      .body(`Sell these items?\n\n${lines.join("\n")}`)
      .button("confirmSell", "§aConfirm Sell", { iconPath: ICONS.sellAll })
      .button("cancel", "Cancel", { iconPath: ICONS.cancel });

    const response = await confirmForm.show(player);
    if (response.canceled || response.id === "cancel") return;

    if (response.id === "confirmSell") {
      const latest = buildSellAllPlan(player, profile);
      if (latest.entries.length === 0) {
        tell(player, "Nothing sellable was found.");
        return;
      }
      const latestBalance = getScore(player, profile.currencyObjective);
      if (latestBalance === undefined) {
        tell(player, `Missing scoreboard objective "${profile.currencyObjective}".`);
        return;
      }
      if (!applySellAllPlan(player, latest.entries)) {
        tell(player, "Inventory changed before the sale could complete. Try again.");
        return;
      }
      setScore(player, profile.currencyObjective, latestBalance + latest.totalGain);
      tell(player, `§aSold all items for §e${latest.totalGain} ${profile.currencyObjective}§a!`);
      return;
    }
    return;
  }
}

export async function openShopTransaction(
  player: Player,
  transactionValue: string
) {
  const [profileOrDefault, itemOrUndefined] = transactionValue.includes("|")
    ? transactionValue.split("|", 2)
    : ["default", transactionValue];

  const profile = findShopProfile(profileOrDefault);
  if (!profile) {
    tell(player, `Shop profile "${profileOrDefault}" was not found.`);
    return;
  }

  const itemToken = String(itemOrUndefined ?? "").trim();
  const keyMatch = /^key:(.+)$/i.exec(itemToken);
  const idxMatch = /^idx:(\d+)$/i.exec(itemToken);
  const item = keyMatch
    ? getShopItemByKey(profile, keyMatch[1].trim())
    : idxMatch
      ? profile.items[Math.floor(Number(idxMatch[1]))]
      : profile.items.find((entry, index) => ensureShopItemId(entry, profile.id, index) === itemToken || normalizeItemId(entry.itemId) === normalizeItemId(itemOrUndefined));
  if (!item) {
    tell(
      player,
      `Shop item "${itemOrUndefined}" was not found in profile "${profile.id}".`
    );
    return;
  }

  const title = shopLabel(item);
  const actionForm = TauUi.action<{ mode: "buy" | "sell" | "sell_all_item"; qty: number }>(`§l${title}§r`)
    .body(
      [
        `Currency: ${profile.currencyObjective}`,
        `Buy price: ${item.canBuy === false ? "Off" : item.buyPrice}`,
        `Sell price: ${item.bundle && item.bundle.length > 0 ? "N/A" : item.canSell === false ? "Off" : item.sellPrice}`,
        `Qty options: ${item.quantities.join(", ")}`,
      ].join("\n")
    );

  for (const qty of item.quantities) {
    const buyCost = item.buyPrice * qty;
    if (item.canBuy !== false && item.buyPrice > 0) {
      actionForm.button(`buy:${qty}`, `Buy ${qty} (-${buyCost})`, { iconPath: ICONS.buy, value: { mode: "buy", qty } });
    }
    if (item.bundle && item.bundle.length > 0) {
      continue;
    }
    if (item.canSell !== false && item.sellPrice > 0) {
      const sellGain = item.sellPrice * qty;
      actionForm.button(`sell:${qty}`, `Sell ${qty} (+${sellGain})`, { iconPath: ICONS.sell, value: { mode: "sell", qty } });
    }
  }
  if (item.canSell !== false && item.sellPrice > 0 && !(item.bundle && item.bundle.length > 0)) {
    actionForm.button("sell_all_item", "Sell All This Item", { iconPath: ICONS.sellAll, value: { mode: "sell_all_item", qty: 0 } });
  }
  actionForm.button("close", "Close", { iconPath: ICONS.cancel });

  const response = await actionForm.show(player);
  if (response.canceled || response.id === "close" || !response.value) return;

  const op = response.value;
  if (op.mode === "buy") {
    const current = getScore(player, profile.currencyObjective);
    if (current === undefined) {
      tell(
        player,
        `Missing scoreboard objective "${profile.currencyObjective}".`
      );
      return;
    }

    const cost = item.buyPrice * op.qty;
    if (current < cost) {
      tell(
        player,
        `You need ${cost} ${profile.currencyObjective} to buy ${op.qty}.`
      );
      return;
    }

    const container = getInventoryContainer(player);
    if (!container) {
      tell(player, "Inventory is unavailable.");
      return;
    }

    const snapshot = snapshotContainer(container);
    const stacks = buildItemStacksForPurchase(item, op.qty);
    for (const stack of stacks) {
      const leftover = container.addItem(stack);
      if (!leftover) continue;
      restoreContainer(container, snapshot);
      tell(player, "Not enough inventory space to complete this purchase.");
      return;
    }

    if (!setScore(player, profile.currencyObjective, current - cost)) {
      restoreContainer(container, snapshot);
      tell(player, "Failed to charge currency; purchase was reverted.");
      return;
    }

    tell(player, `Purchased ${op.qty}x ${shopLabel(item)} for ${cost}.`);
  } else if (op.mode === "sell") {
    const owned = getItemInstanceCount(player, item);
    if (owned < op.qty) {
      tell(player, `You need ${op.qty}x ${shopLabel(item)} to sell.`);
      return;
    }

    const current = getScore(player, profile.currencyObjective);
    if (current === undefined) {
      tell(player, `Missing scoreboard objective "${profile.currencyObjective}".`);
      return;
    }

    if (!removeItemInstance(player, item, op.qty)) {
      tell(player, "Sell failed while removing items.");
      return;
    }

    const gain = item.sellPrice * op.qty;
    if (!setScore(player, profile.currencyObjective, current + gain)) {
      tell(player, "Failed to add currency after selling.");
      return;
    }

    tell(player, `Sold ${op.qty}x ${shopLabel(item)} for ${gain}.`);
  } else {
    const owned = getItemInstanceCount(player, item);
    if (owned <= 0) {
      tell(player, `You have no ${shopLabel(item)} to sell.`);
      return;
    }

    const current = getScore(player, profile.currencyObjective);
    if (current === undefined) {
      tell(player, `Missing scoreboard objective "${profile.currencyObjective}".`);
      return;
    }

    if (!removeItemInstance(player, item, owned)) {
      tell(player, "Sell-all failed while removing items.");
      return;
    }

    const gain = item.sellPrice * owned;
    if (!setScore(player, profile.currencyObjective, current + gain)) {
      tell(player, "Failed to add currency after selling all items.");
      return;
    }

    tell(player, `Sold all ${owned}x ${shopLabel(item)} for ${gain}.`);
  }
}

export async function showShopProfilesEditor(player: Player) {
  while (true) {
    const ids = Object.keys(state.shops);
    const form = TauUi.action<{ profileId: string }>("Shop Profiles")
      .body(`Profiles: ${ids.length}`)
      .button("createProfile", "Create new profile", { iconPath: ICONS.confirm })
      .button("deleteProfile", "Delete profile", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back });

    for (const id of ids) {
      form.button(id, id, { iconPath: ICONS.shop, value: { profileId: id } });
    }
    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "createProfile") {
      const modal = TauUi.modal("Create Shop Profile")
        .text("profileId", "Profile ID", { placeholder: "default", defaultValue: "default" })
        .text("currencyObjective", "Currency objective", { placeholder: "money", defaultValue: "money" })
        .submitButton("Create");
      const result = await modal.show(player);
      if (result.canceled) continue;
      const id = String(result.values.profileId ?? "").trim();
      const objective = String(result.values.currencyObjective ?? "").trim();
      if (!id || !objective) continue;
      state.shops[id] = state.shops[id] ?? {
        id,
        currencyObjective: objective,
        categories: [],
        items: [],
      };
      state.shops[id].currencyObjective = objective;
      saveShops();
      await showShopItemEditor(player, id);
      continue;
    }

    if (response.id === "deleteProfile") {
      if (ids.length === 0) {
        tell(player, "No profiles to delete.");
        continue;
      }
      const picker = TauUi.action<{ profileId: string }>("Delete Shop Profile");
      for (const id of ids) picker.button(id, id, { iconPath: ICONS.delete, value: { profileId: id } });
      picker.button("cancel", "Cancel", { iconPath: ICONS.cancel });
      const pick = await picker.show(player);
      if (pick.canceled || pick.id === "cancel") continue;
      const id = pick.value && typeof pick.value === "object" && "profileId" in pick.value ? (pick.value as { profileId: string }).profileId : pick.id;
      if (!ids.includes(id)) continue;
      delete state.shops[id];
      saveShops();
      tell(player, `Deleted profile "${id}".`);
      continue;
    }

    if (response.value && typeof response.value === "object" && "profileId" in response.value) {
      const pid = (response.value as { profileId: string }).profileId;
      if (ids.includes(pid)) {
        await showShopItemEditor(player, pid);
        continue;
      }
    }

    return;
  }
}

async function showShopItemEditor(player: Player, profileId: string) {
  const profile = findShopProfile(profileId);
  if (!profile) {
    tell(player, `Shop profile "${profileId}" was not found.`);
    return;
  }
    while (true) {
    const categories = categoryList(profile);
    const sortMode = profile.sortMode ?? "default";
    const sortModes: ShopSortMode[] = ["default", "name", "buyPrice", "sellPrice", "category"];
    const sortLabels: Record<ShopSortMode, string> = {
      default: "Default",
      name: "Name (A-Z)",
      buyPrice: "Buy Price (Low)",
      sellPrice: "Sell Price (Low)",
      category: "Category (A-Z)",
    };
    const picker = TauUi.action(`Shop Profile: ${profile.id}`)
      .body(`Currency: ${profile.currencyObjective}\nSort: ${sortLabels[sortMode]}\nCategories: ${categories.length}`)
      .button("setCurrency", "Set currency objective", { iconPath: ICONS.settings })
      .button("categories", "Categories", { iconPath: ICONS.menu })
      .button("sort", `Sort: ${sortLabels[sortMode]}`, { iconPath: ICONS.settings })
      .button("addItem", "Add item", { iconPath: ICONS.confirm })
      .button("addKit", "Add kit", { iconPath: ICONS.shop })
      .button("addHeldItem", "Add held item", { iconPath: ICONS.binding })
      .button("sellAll", "Sell all sellable", { iconPath: ICONS.sellAll })
      .button("back", "Back", { iconPath: ICONS.back });

    const response = await picker.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "setCurrency") {
      const modal = TauUi.modal("Set Currency Objective")
        .text("objective", "Objective", { placeholder: "money", defaultValue: profile.currencyObjective })
        .submitButton("Save");
      const result = await modal.show(player);
      if (result.canceled) continue;
      const objective = String(result.values.objective ?? "").trim();
      if (!objective) continue;
      profile.currencyObjective = objective;
      saveShops();
      tell(player, `Currency objective updated to "${objective}".`);
      continue;
    }

    if (response.id === "categories") {
      await showCategoryManager(player, profile);
      continue;
    }

    if (response.id === "sort") {
      const sortForm = TauUi.action<{ mode: ShopSortMode }>("Sort Mode")
        .body("Choose how items are sorted in this shop.");
      for (const mode of sortModes) {
        const checked = mode === sortMode ? "§a✓ " : "  ";
        sortForm.button(mode, `${checked}${sortLabels[mode]}`, { iconPath: ICONS.settings, value: { mode } });
      }
      sortForm.button("back", "Back", { iconPath: ICONS.back });

      const sortResponse = await sortForm.show(player);
      if (sortResponse.canceled || sortResponse.id === "back") continue;
      if (sortResponse.value && typeof sortResponse.value === "object" && "mode" in sortResponse.value) {
        const selectedMode = (sortResponse.value as { mode: ShopSortMode }).mode;
        if (sortModes.includes(selectedMode)) {
          profile.sortMode = selectedMode;
          saveShops();
          tell(player, `Sort mode set to "${sortLabels[profile.sortMode]}".`);
        }
      }
      continue;
    }

    if (response.id === "addItem") {
      const modal = TauUi.modal("Add Shop Item")
        .text("itemId", "Item ID", { placeholder: "minecraft:iron_ingot" })
        .text("label", "Shop label", { placeholder: "Iron Ingot" })
        .text("displayName", "Item display name (optional)", { placeholder: "Shown on given item" })
        .text("category", "Category (optional)", { placeholder: "Tools" })
        .toggle("canBuy", "Can be bought", true)
        .text("buyPrice", "Buy price", { placeholder: "30", defaultValue: "30" })
        .toggle("canSell", "Can be sold", true)
        .text("sellPrice", "Sell price", { placeholder: "15", defaultValue: "15" })
        .text("quantities", "Quantities (comma-separated)", { placeholder: "1,16,64", defaultValue: "1,16,64" })
        .text("kitItems", "Kit items (optional)", { placeholder: "", defaultValue: "" })
        .submitButton("Add");
      const result = await modal.show(player);
      if (result.canceled) continue;

      const itemId = String(result.values.itemId ?? "").trim();
      const label = String(result.values.label ?? "").trim();
      const displayName = String(result.values.displayName ?? "").trim();
      const category = String(result.values.category ?? "").trim();
      const canBuy = Boolean(result.values.canBuy);
      const buyPrice = Math.max(0, Math.floor(Number(result.values.buyPrice ?? 0)));
      const canSell = Boolean(result.values.canSell);
      const sellPrice = Math.max(0, Math.floor(Number(result.values.sellPrice ?? 0)));
      const quantities = (String(result.values.quantities ?? "1"))
        .split(",")
        .map((v: string) => Math.max(1, Math.floor(Number(v.trim()))))
        .filter((v: number, i: number, a: number[]) => a.indexOf(v) === i)
        .sort((a: number, b: number) => a - b);
      const bundle = splitList(String(result.values.kitItems ?? "")).map(parseItemStackDefinitionLine).filter((entry): entry is ShopItemStackDefinition => Boolean(entry));

      if (!itemId) {
        tell(player, "Item ID is required.");
        continue;
      }

      const nextItem: ShopItemDefinition = {
        itemId,
        label: label || itemId,
        displayName: displayName || undefined,
        category: category || undefined,
        buyPrice: canBuy ? buyPrice : 0,
        canBuy,
        sellPrice: canSell ? sellPrice : 0,
        canSell,
        quantities: quantities.length > 0 ? quantities : [1],
        bundle: bundle.length > 0 ? bundle : undefined,
      };

      ensureShopItemId(nextItem, profile.id, profile.items.length);
      profile.items.push(nextItem);
      saveShops();
      tell(player, `Added item ${itemId}.`);
      continue;
    }

    if (response.id === "addKit") {
      await kitBuilderFlow(player, profile);
      continue;
    }

    if (response.id === "addHeldItem") {
      await addHeldItemFlow(player, profile);
      continue;
    }

    if (response.id === "sellAll") {
      await sellAllSellableItems(player, profile.id);
      continue;
    }

    return;
  }
}
