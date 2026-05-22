import { Player } from "@minecraft/server";
import { TauUi } from "../../ui";
import { canonicalShopId, findShopProfile, isFeatureEnabled, normalizeCategory, setScore, state, saveShops, tell } from "../../storage";
import { type ShopItemDefinition, type ShopItemStackDefinition, type ShopKitDraft, type ShopProfile, type ShopSortMode } from "../../types";
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
import { cleanQuantities, addHeldItemFlow, showCategoryManager, editKitItemFlow } from "./front";
import { sellAllSellableItems } from "./transaction";

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

export function getKitDraft(profile: ShopProfile): ShopKitDraft {
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

export async function kitBuilderFlow(player: Player, profile: ShopProfile, existing?: ShopItemDefinition, category?: string) {
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

export async function showShopItemActions(player: Player, profile: ShopProfile, itemIndex: number) {
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
          item.exactDurability ? "§aStrict sell matching" : "",
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
          `Strict Sell Matching: ${exactLabel}`,
          `Show Enchants in Preview: ${showLabel}`,
          `Custom Data: ${item.customData ? "Set" : "None"}`,
        ].join("\n")
      )
      .button("toggleExactDurability", "Toggle Strict Sell Matching", { iconPath: ICONS.settings })
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

export async function openShopEditor(player: Player, profileId: string) {
  await showShopItemEditor(player, canonicalShopId(profileId));
}

export async function showShopItemEditor(player: Player, profileId: string) {
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
