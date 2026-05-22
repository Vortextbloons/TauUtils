import { ItemStack, Player } from "@minecraft/server";
import { TauUi } from "../../ui";
import { canonicalShopId, findShopProfile, getInventoryContainer, getScore, isFeatureEnabled, normalizeCategory, setScore, state, saveShops, tell } from "../../storage";
import { type ShopItemDefinition, type ShopItemStackDefinition, type ShopProfile } from "../../types";
import {
  iconForShopItem,
  shopLabel,
  shopItemKey,
  ensureShopItemId,
  splitList,
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
} from "../utils";
import { normalizeItemId } from "../../shared/item-id";
import { ICONS } from "../../ui/icons";
import { kitBuilderFlow, showShopItemActions, getKitDraft } from "./editor";
import { sellAllSellableItems, openShopTransaction } from "./transaction";

export async function openShopProfile(player: Player, profileId: string) {
  await showShopFront(player, canonicalShopId(profileId));
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

export async function showCategoryManager(player: Player, profile: ShopProfile) {
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

export async function addHeldItemFlow(player: Player, profile: ShopProfile, category?: string) {
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

async function addKitItemFlow(player: Player, profile: ShopProfile, category?: string) {
  const draft = getKitDraft(profile);
  draft.category = category ?? draft.category;
  profile.kitDraft = draft;
  saveShops();
  await kitBuilderFlow(player, profile, undefined, category);
}

export async function editKitItemFlow(player: Player, profile: ShopProfile, itemIndex: number) {
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

export function cleanQuantities(raw: string): number[] {
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
