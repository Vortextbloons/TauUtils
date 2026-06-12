import { EntityComponentTypes, ItemStack, Player } from "@minecraft/server";
import { TauUi } from "../ui";
import { deserializeItemStack, serializeItemStack } from "../shared/item-serialization";
import { ICONS, type PlayerShop, type PlayerShopListing } from "../types";
import { getInventoryContainer, getOnlinePlayerById, getPlayerId, getScore, isOperator, savePlayerShops, setScore, state, tell } from "../storage";
import { estimateUtf8Bytes } from "../shared/utf8";

type TradeResult = {
  ok: boolean;
  message: string;
};

const listingLocks = new Set<string>();
const MAX_LISTING_ITEM_BYTES = 24000;

function nowMs(): number {
  return Date.now();
}

function normalizeKey(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function hasCustomItemData(stack: ItemStack): boolean {
  if ((stack.nameTag ?? "").trim().length > 0) return true;
  try {
    if (stack.getLore().length > 0) return true;
  } catch {
    // ignore
  }
  try {
    const component = stack.getComponent("minecraft:enchantable") as { getEnchantments?: () => unknown[] } | undefined;
    if (component?.getEnchantments && component.getEnchantments().length > 0) return true;
  } catch {
    // ignore
  }
  try {
    if (stack.getDynamicPropertyIds().length > 0) return true;
  } catch {
    // ignore
  }
  return false;
}

function resolveCurrencyObjective(shop: PlayerShop): string {
  const configured = String(shop.currencyObjective ?? "").trim();
  return configured || state.playerShops.config.defaultCurrencyObjective;
}

function resolvePlayerNameById(playerId: string, fallback = "Player"): string {
  for (const [name, id] of Object.entries(state.stats.playerIds)) {
    if (id === playerId) return name;
  }
  return fallback;
}

function getOwnedShop(player: Player): PlayerShop | undefined {
  const playerId = getPlayerId(player);
  return Object.values(state.playerShops.shops).find((shop) => shop.ownerPlayerId === playerId);
}

function getOrCreateOwnedShop(player: Player): PlayerShop {
  const existing = getOwnedShop(player);
  if (existing) return existing;

  const playerId = getPlayerId(player);
  const id = `pshop:${normalizeKey(player.name).replace(/[^a-z0-9_-]+/g, "_")}:${Math.random().toString(36).slice(2, 8)}`;
  const created: PlayerShop = {
    id,
    ownerPlayerId: playerId,
    ownerName: player.name,
    title: `${player.name}'s Shop`,
    description: "",
    visibility: state.playerShops.config.defaultVisibility,
    currencyObjective: state.playerShops.config.defaultCurrencyObjective,
    listingIds: [],
    createdAt: nowMs(),
    updatedAt: nowMs(),
  };
  state.playerShops.shops[id] = created;
  savePlayerShops();
  return created;
}

type InventorySlotEntry = {
  slotIndex: number;
  stack: ItemStack;
};

function listInventoryStacks(player: Player): InventorySlotEntry[] {
  const container = getInventoryContainer(player);
  if (!container) return [];

  const items: InventorySlotEntry[] = [];
  for (let slotIndex = 0; slotIndex < container.size; slotIndex++) {
    const stack = container.getItem(slotIndex);
    if (!stack) continue;
    items.push({ slotIndex, stack });
  }
  return items;
}

function removeQuantityFromSlot(player: Player, slotIndex: number, quantity: number): ItemStack | undefined {
  const container = getInventoryContainer(player);
  if (!container) return undefined;

  const held = container.getItem(slotIndex);
  if (!held) return undefined;
  const amount = Math.max(1, Math.floor(quantity));
  if (held.amount < amount) return undefined;

  const next = held.clone();
  next.amount = amount;

  if (held.amount === amount) container.setItem(slotIndex, undefined);
  else {
    held.amount -= amount;
    container.setItem(slotIndex, held);
  }

  return next;
}

function addItemToPlayerInventory(player: Player, stack: ItemStack): boolean {
  const container = getInventoryContainer(player);
  if (!container) return false;
  const leftover = container.addItem(stack);
  return !leftover;
}

function removeMatchingSingleStack(player: Player, target: ItemStack): boolean {
  const container = getInventoryContainer(player);
  if (!container) return false;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (!stack) continue;
    if (!stack.isStackableWith(target)) continue;
    if (stack.amount !== target.amount) continue;
    container.setItem(slot, undefined);
    return true;
  }
  return false;
}

function findListingById(listingId: string): PlayerShopListing | undefined {
  return state.playerShops.listings[listingId];
}

function compactShopListings(shop: PlayerShop): void {
  shop.listingIds = shop.listingIds.filter((listingId) => Boolean(state.playerShops.listings[listingId]));
}

function pushOfflineEarnings(playerId: string, objective: string, amount: number): void {
  if (amount <= 0) return;
  state.playerShops.earningsByPlayerId[playerId] ??= {};
  const bucket = state.playerShops.earningsByPlayerId[playerId];
  bucket[objective] = Math.max(0, Math.floor((bucket[objective] ?? 0) + amount));
}

function applyTax(gross: number): { sellerNet: number; tax: number } {
  const taxPercent = Math.max(0, Math.floor(Number(state.playerShops.config.taxPercent ?? 0)));
  const tax = Math.floor((gross * taxPercent) / 100);
  return { sellerNet: Math.max(0, gross - tax), tax };
}

function marketplaceListings(): PlayerShopListing[] {
  const visibleShopIds = new Set(
    Object.values(state.playerShops.shops)
      .filter((shop) => shop.visibility === "public")
      .map((shop) => shop.id)
  );
  return Object.values(state.playerShops.listings)
    .filter((listing) => visibleShopIds.has(listing.shopId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function claimPlayerShopEarnings(player: Player): TradeResult {
  const playerId = getPlayerId(player);
  const buckets = state.playerShops.earningsByPlayerId[playerId];
  if (!buckets || Object.keys(buckets).length === 0) {
    return { ok: false, message: "No pending shop earnings." };
  }

  let claimedTotal = 0;
  const objectiveLines: string[] = [];

  for (const [objective, amountRaw] of Object.entries(buckets)) {
    const amount = Math.max(0, Math.floor(Number(amountRaw ?? 0)));
    if (amount <= 0) continue;
    const current = getScore(player, objective);
    if (current === undefined) continue;
    if (!setScore(player, objective, current + amount)) continue;
    claimedTotal += amount;
    objectiveLines.push(`${amount} ${objective}`);
    delete buckets[objective];
  }

  if (Object.keys(buckets).length === 0) {
    delete state.playerShops.earningsByPlayerId[playerId];
  }
  savePlayerShops();

  if (claimedTotal <= 0) return { ok: false, message: "Could not claim earnings (missing objective)." };
  return { ok: true, message: `Claimed: ${objectiveLines.join(", ")}` };
}

function notifySaleIfOnline(sellerPlayerId: string, text: string): void {
  const online = getOnlinePlayerById(sellerPlayerId);
  if (!online) return;
  tell(online, text);
}

function purchaseListing(buyer: Player, listing: PlayerShopListing): TradeResult {
  if (!state.playerShops.config.enabled) return { ok: false, message: "Player shops are disabled." };
  if (listing.quantity <= 0) return { ok: false, message: "Listing is out of stock." };
  if (listingLocks.has(listing.id)) return { ok: false, message: "Listing is currently being processed." };
  if (listing.sellerPlayerId === getPlayerId(buyer)) return { ok: false, message: "You cannot buy your own listing." };

  listingLocks.add(listing.id);
  try {
    const objective = listing.currencyObjective;
    const buyerBalance = getScore(buyer, objective);
    if (buyerBalance === undefined) return { ok: false, message: `Missing scoreboard objective "${objective}".` };
    const totalPrice = Math.max(1, Math.floor(listing.pricePerUnit * listing.quantity));
    if (buyerBalance < totalPrice) return { ok: false, message: `You need ${totalPrice} ${objective}.` };

    const stack = deserializeItemStack(listing.item);
    stack.amount = listing.quantity;

    if (!addItemToPlayerInventory(buyer, stack)) {
      return { ok: false, message: "Not enough inventory space." };
    }

    if (!setScore(buyer, objective, buyerBalance - totalPrice)) {
      removeMatchingSingleStack(buyer, stack);
      return { ok: false, message: "Failed to charge buyer." };
    }

    const { sellerNet } = applyTax(totalPrice);
    pushOfflineEarnings(listing.sellerPlayerId, objective, sellerNet);

    const purchasedQuantity = listing.quantity;
    listing.quantity = 0;
    listing.updatedAt = nowMs();
    if (listing.quantity <= 0) {
      delete state.playerShops.listings[listing.id];
      const shop = state.playerShops.shops[listing.shopId];
      if (shop) {
        shop.listingIds = shop.listingIds.filter((id) => id !== listing.id);
        shop.updatedAt = nowMs();
      }
    }

    savePlayerShops();

    if (state.playerShops.config.announceSales) {
      notifySaleIfOnline(
        listing.sellerPlayerId,
        `§a${buyer.name} bought ${purchasedQuantity}x ${listing.title} for ${totalPrice} ${objective}.`
      );
    }

    return { ok: true, message: `Purchased ${purchasedQuantity}x ${listing.title} for ${totalPrice} ${objective}.` };
  } finally {
    listingLocks.delete(listing.id);
  }
}

async function openListingCreateFlow(player: Player, shop: PlayerShop): Promise<void> {
  if (!state.playerShops.config.enabled) {
    tell(player, "Player shops are disabled.");
    return;
  }

  compactShopListings(shop);
  if (shop.listingIds.length >= Math.max(1, state.playerShops.config.maxListingsPerShop)) {
    tell(player, `Listing cap reached (${state.playerShops.config.maxListingsPerShop}).`);
    return;
  }

  const inventory = listInventoryStacks(player);
  if (inventory.length === 0) {
    tell(player, "Your inventory is empty.");
    return;
  }
  const picker = TauUi.action<{ index: number }>("Create Listing").body("Select an item stack from your inventory.");
  for (const entry of inventory.slice(0, 28)) {
    const stack = entry.stack;
    picker.button(`slot:${entry.slotIndex}`, `Slot ${entry.slotIndex + 1}: ${stack.nameTag?.trim() || stack.typeId} x${stack.amount}`, { iconPath: ICONS.menu, value: { index: entry.slotIndex } });
  }
  picker.button("back", "Back", { iconPath: ICONS.back });

  const chosen = await picker.show(player);
  if (chosen.canceled || chosen.id === "back") return;

  const selectedEntry = inventory.find((e) => e.slotIndex === chosen.value?.index);
  if (!selectedEntry) return;

  if (!state.playerShops.config.allowCustomItems && hasCustomItemData(selectedEntry.stack)) {
    tell(player, "Custom item listings are disabled by admin config.");
    return;
  }

  const modal = TauUi.modal("Create Listing")
    .text("title", "Title", { defaultValue: selectedEntry.stack.nameTag?.trim() || selectedEntry.stack.typeId })
    .text("category", "Category (optional)", { placeholder: "blocks", defaultValue: "" })
    .text("quantity", "Quantity to sell", { defaultValue: String(selectedEntry.stack.amount) })
    .text("pricePerUnit", "Price per unit", { placeholder: "100", defaultValue: "100" })
    .submitButton("Create");

  const result = await modal.show(player);
  if (result.canceled) return;

  const title = String(result.values.title ?? "").trim() || selectedEntry.stack.typeId;
  const category = String(result.values.category ?? "").trim() || undefined;
  const quantity = Math.max(1, Math.min(selectedEntry.stack.amount, Math.floor(Number(result.values.quantity ?? selectedEntry.stack.amount))));
  const rawPrice = Math.floor(Number(result.values.pricePerUnit ?? 0));
  const pricePerUnit = Math.max(
    Math.max(1, state.playerShops.config.minPricePerUnit),
    Math.min(Math.max(1, state.playerShops.config.maxPricePerUnit), rawPrice)
  );
  const currencyObjective = resolveCurrencyObjective(shop);

  const escrowed = removeQuantityFromSlot(player, selectedEntry.slotIndex, quantity);
  if (!escrowed) {
    tell(player, "Could not remove the selected item.");
    return;
  }

  escrowed.amount = quantity;

  const listingId = `listing:${shop.id}:${nowMs()}:${Math.random().toString(36).slice(2, 8)}`;
  const listing: PlayerShopListing = {
    id: listingId,
    shopId: shop.id,
    sellerPlayerId: shop.ownerPlayerId,
    sellerName: shop.ownerName,
    title,
    category,
    item: serializeItemStack(escrowed),
    quantity,
    pricePerUnit,
    currencyObjective,
    createdAt: nowMs(),
    updatedAt: nowMs(),
  };

  const listingBytes = estimateUtf8Bytes(JSON.stringify(listing.item));
  if (listingBytes > MAX_LISTING_ITEM_BYTES) {
    const container = getInventoryContainer(player);
    if (container) {
      const leftover = container.addItem(escrowed);
      if (leftover) player.dimension.spawnItem(leftover, player.location);
    }
    tell(player, "This item is too large to store in a listing.");
    return;
  }

  state.playerShops.listings[listingId] = listing;
  shop.listingIds.push(listingId);
  shop.updatedAt = nowMs();
  savePlayerShops();
  tell(player, `Listed ${quantity}x ${title} for ${pricePerUnit} ${currencyObjective} each.`);
}

async function openListingCancelFlow(player: Player, shop: PlayerShop): Promise<void> {
  compactShopListings(shop);
  if (shop.listingIds.length === 0) {
    tell(player, "No listings to cancel.");
    return;
  }

  const menu = TauUi.action<{ listingId: string }>("Cancel Listing");
  for (const listingId of shop.listingIds) {
    const listing = findListingById(listingId);
    if (!listing) continue;
    menu.button(listingId, `${listing.title} (${listing.pricePerUnit} ${listing.currencyObjective})`, { iconPath: ICONS.delete, value: { listingId } });
  }
  menu.button("back", "Back", { iconPath: ICONS.back });

  const response = await menu.show(player);
  if (response.canceled || response.id === "back") return;

  const listingId = response.value?.listingId;
  if (!listingId) return;
  const listing = findListingById(listingId);
  if (!listing) {
    tell(player, "Listing not found.");
    return;
  }

  const stack = deserializeItemStack(listing.item);
  stack.amount = 1;
  if (!addItemToPlayerInventory(player, stack)) {
    tell(player, "No inventory space to return item.");
    return;
  }

  delete state.playerShops.listings[listingId];
  shop.listingIds = shop.listingIds.filter((id) => id !== listingId);
  shop.updatedAt = nowMs();
  savePlayerShops();
  tell(player, `Cancelled listing ${listing.title}.`);
}

async function openShopSettingsFlow(player: Player, shop: PlayerShop): Promise<void> {
  const modal = TauUi.modal("My Shop Settings")
    .text("title", "Title", { placeholder: "My Shop", defaultValue: shop.title })
    .text("description", "Description", { placeholder: "optional", defaultValue: shop.description ?? "" })
    .toggle("isPublic", "Public", shop.visibility === "public")
    .text("currencyObjective", "Currency objective", { defaultValue: shop.currencyObjective })
    .submitButton("Save");

  const result = await modal.show(player);
  if (result.canceled) return;

  shop.title = String(result.values.title ?? shop.title).trim() || shop.title;
  shop.description = String(result.values.description ?? "").trim() || undefined;
  shop.visibility = Boolean(result.values.isPublic) ? "public" : "private";
  shop.updatedAt = nowMs();
  savePlayerShops();
  tell(player, "Shop settings saved.");
}

export async function openMyPlayerShop(player: Player): Promise<void> {
  if (!state.playerShops.config.enabled) {
    tell(player, "Player shops are disabled.");
    return;
  }

  const shop = getOrCreateOwnedShop(player);

  while (true) {
    compactShopListings(shop);
    const pending = state.playerShops.earningsByPlayerId[getPlayerId(player)] ?? {};
    const pendingTotal = Object.values(pending).reduce((sum, value) => sum + Math.max(0, Math.floor(value)), 0);
    const menu = TauUi.action(shop.title)
      .body(
        [
          `Listings: ${shop.listingIds.length}`,
          `Visibility: ${shop.visibility}`,
          `Currency: ${shop.currencyObjective}`,
          `Pending earnings: ${pendingTotal}`,
          "Select an item stack from your inventory to create a listing.",
        ].join("\n")
      )
      .button("createListing", "Create Listing", { iconPath: ICONS.confirm })
      .button("cancelListing", "Cancel Listing", { iconPath: ICONS.delete })
      .button("settings", "Shop Settings", { iconPath: ICONS.settings })
      .button("claimEarnings", "Claim Earnings", { iconPath: ICONS.shop })
      .button("browseMarketplace", "Browse Marketplace", { iconPath: ICONS.menu })
      .button("back", "Back", { iconPath: ICONS.back });

    const response = await menu.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "createListing") {
      await openListingCreateFlow(player, shop);
      continue;
    }
    if (response.id === "cancelListing") {
      await openListingCancelFlow(player, shop);
      continue;
    }
    if (response.id === "settings") {
      await openShopSettingsFlow(player, shop);
      continue;
    }
    if (response.id === "claimEarnings") {
      const result = claimPlayerShopEarnings(player);
      tell(player, result.ok ? result.message : `§e${result.message}`);
      continue;
    }
    if (response.id === "browseMarketplace") {
      await openPlayerMarketplace(player);
      continue;
    }
    return;
  }
}

export async function openPlayerMarketplace(player: Player): Promise<void> {
  if (!state.playerShops.config.enabled) {
    tell(player, "Player shops are disabled.");
    return;
  }

  while (true) {
    const listings = marketplaceListings();
    const menu = TauUi.action<{ index: number }>("Player Marketplace").body(`Listings: ${listings.length}`);
    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      menu.button(`listing:${i}`, `${listing.title} x${listing.quantity} - ${listing.pricePerUnit} each`, { iconPath: ICONS.shop, value: { index: i } });
    }
    menu.button("back", "Back", { iconPath: ICONS.back });

    const response = await menu.show(player);
    if (response.canceled || response.id === "back") return;
    if (response.value?.index === undefined) return;

    const listing = listings[response.value.index];
    if (!listing) return;
    const sellerName = resolvePlayerNameById(listing.sellerPlayerId, listing.sellerName);
    const preview = TauUi.action(listing.title)
      .body(
        [
          `Seller: ${sellerName}`,
          `Quantity: ${listing.quantity}`,
          `Price each: ${listing.pricePerUnit} ${listing.currencyObjective}`,
          `Total: ${listing.pricePerUnit * listing.quantity} ${listing.currencyObjective}`,
          `Category: ${listing.category ?? "uncategorized"}`,
          `Item: ${listing.item.itemId}`,
          listing.item.nameTag ? `Name: ${listing.item.nameTag}` : "",
          listing.item.lore && listing.item.lore.length > 0 ? `Lore: ${listing.item.lore.slice(0, 3).join(" | ")}` : "",
        ].filter((line) => line.length > 0).join("\n")
      )
      .button("buy", "Buy Listing", { iconPath: ICONS.buy })
      .button("back", "Back", { iconPath: ICONS.back });

    const confirm = await preview.show(player);
    if (confirm.canceled || confirm.id !== "buy") continue;

    const result = purchaseListing(player, listing);
    tell(player, result.ok ? result.message : `§c${result.message}`);
  }
}

export async function openPlayerShopAdmin(player: Player): Promise<void> {
  if (!isOperator(player)) {
    tell(player, "Operator required.");
    return;
  }

  while (true) {
    const config = state.playerShops.config;
    const modal = TauUi.modal("Player Shop Settings")
      .toggle("enabled", "Enabled", config.enabled)
      .text("defaultCurrencyObjective", "Default currency objective", { placeholder: "money", defaultValue: config.defaultCurrencyObjective })
      .toggle("allowCustomItems", "Allow custom items", config.allowCustomItems)
      .text("minPricePerUnit", "Min price per unit", { placeholder: "1", defaultValue: String(config.minPricePerUnit) })
      .text("maxPricePerUnit", "Max price per unit", { placeholder: "1000000", defaultValue: String(config.maxPricePerUnit) })
      .text("taxPercent", "Tax percent", { placeholder: "0", defaultValue: String(config.taxPercent) })
      .text("maxListingsPerShop", "Max listings per shop", { placeholder: "32", defaultValue: String(config.maxListingsPerShop) })
      .toggle("defaultPublicVisibility", "Default public visibility", config.defaultVisibility === "public")
      .toggle("announceSales", "Announce sales", config.announceSales)
      .submitButton("Save");

    const result = await modal.show(player);
    if (result.canceled) return;

    config.enabled = Boolean(result.values.enabled);
    config.defaultCurrencyObjective = String(result.values.defaultCurrencyObjective ?? config.defaultCurrencyObjective).trim() || config.defaultCurrencyObjective;
    config.allowCustomItems = Boolean(result.values.allowCustomItems);
    config.minPricePerUnit = Math.max(1, Math.floor(Number(result.values.minPricePerUnit ?? config.minPricePerUnit)));
    config.maxPricePerUnit = Math.max(config.minPricePerUnit, Math.floor(Number(result.values.maxPricePerUnit ?? config.maxPricePerUnit)));
    config.taxPercent = Math.max(0, Math.floor(Number(result.values.taxPercent ?? config.taxPercent)));
    config.maxListingsPerShop = Math.max(1, Math.floor(Number(result.values.maxListingsPerShop ?? config.maxListingsPerShop)));
    config.defaultVisibility = Boolean(result.values.defaultPublicVisibility) ? "public" : "private";
    config.announceSales = Boolean(result.values.announceSales);
    savePlayerShops();
    tell(player, "Player shop config saved.");
    return;
  }
}
