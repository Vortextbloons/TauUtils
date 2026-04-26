import { world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { deserializeItemStack, serializeItemStack } from "./item-serialization";
import { ICONS } from "./tau-models";
import { getInventoryContainer, getPlayerId, getScore, isOperator, savePlayerShops, setScore, state, tell } from "./storage";
const listingLocks = new Set();
const MAX_LISTING_ITEM_BYTES = 24000;
function nowMs() {
    return Date.now();
}
function normalizeKey(value) {
    return String(value ?? "").trim().toLowerCase();
}
function hasCustomItemData(stack) {
    if ((stack.nameTag ?? "").trim().length > 0)
        return true;
    try {
        if (stack.getLore().length > 0)
            return true;
    }
    catch {
        // ignore
    }
    try {
        const component = stack.getComponent("minecraft:enchantable");
        if (component?.getEnchantments && component.getEnchantments().length > 0)
            return true;
    }
    catch {
        // ignore
    }
    try {
        if (stack.getDynamicPropertyIds().length > 0)
            return true;
    }
    catch {
        // ignore
    }
    return false;
}
function resolveCurrencyObjective(shop) {
    const configured = String(shop.currencyObjective ?? "").trim();
    return configured || state.playerShops.config.defaultCurrencyObjective;
}
function resolvePlayerNameById(playerId, fallback = "Player") {
    for (const [name, id] of Object.entries(state.stats.playerIds)) {
        if (id === playerId)
            return name;
    }
    return fallback;
}
function getOwnedShop(player) {
    const playerId = getPlayerId(player);
    return Object.values(state.playerShops.shops).find((shop) => shop.ownerPlayerId === playerId);
}
function getOrCreateOwnedShop(player) {
    const existing = getOwnedShop(player);
    if (existing)
        return existing;
    const playerId = getPlayerId(player);
    const id = `pshop:${normalizeKey(player.name).replace(/[^a-z0-9_-]+/g, "_")}:${Math.random().toString(36).slice(2, 8)}`;
    const created = {
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
function estimateUtf8Bytes(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code <= 0x7f)
            bytes += 1;
        else if (code <= 0x7ff)
            bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
            bytes += 4;
            i++;
        }
        else
            bytes += 3;
    }
    return bytes;
}
function listInventoryStacks(player) {
    const container = getInventoryContainer(player);
    if (!container)
        return [];
    const items = [];
    for (let slotIndex = 0; slotIndex < container.size; slotIndex++) {
        const stack = container.getItem(slotIndex);
        if (!stack)
            continue;
        items.push({ slotIndex, stack });
    }
    return items;
}
function removeQuantityFromSlot(player, slotIndex, quantity) {
    const container = getInventoryContainer(player);
    if (!container)
        return undefined;
    const held = container.getItem(slotIndex);
    if (!held)
        return undefined;
    const amount = Math.max(1, Math.floor(quantity));
    if (held.amount < amount)
        return undefined;
    const next = held.clone();
    next.amount = amount;
    if (held.amount === amount)
        container.setItem(slotIndex, undefined);
    else {
        held.amount -= amount;
        container.setItem(slotIndex, held);
    }
    return next;
}
function addItemToPlayerInventory(player, stack) {
    const container = getInventoryContainer(player);
    if (!container)
        return false;
    const leftover = container.addItem(stack);
    return !leftover;
}
function removeMatchingSingleStack(player, target) {
    const container = getInventoryContainer(player);
    if (!container)
        return false;
    for (let slot = 0; slot < container.size; slot++) {
        const stack = container.getItem(slot);
        if (!stack)
            continue;
        if (!stack.isStackableWith(target))
            continue;
        if (stack.amount !== target.amount)
            continue;
        container.setItem(slot, undefined);
        return true;
    }
    return false;
}
function findListingById(listingId) {
    return state.playerShops.listings[listingId];
}
function compactShopListings(shop) {
    shop.listingIds = shop.listingIds.filter((listingId) => Boolean(state.playerShops.listings[listingId]));
}
function pushOfflineEarnings(playerId, objective, amount) {
    var _a;
    if (amount <= 0)
        return;
    (_a = state.playerShops.earningsByPlayerId)[playerId] ?? (_a[playerId] = {});
    const bucket = state.playerShops.earningsByPlayerId[playerId];
    bucket[objective] = Math.max(0, Math.floor((bucket[objective] ?? 0) + amount));
}
function applyTax(gross) {
    const taxPercent = Math.max(0, Math.floor(Number(state.playerShops.config.taxPercent ?? 0)));
    const tax = Math.floor((gross * taxPercent) / 100);
    return { sellerNet: Math.max(0, gross - tax), tax };
}
function marketplaceListings() {
    const visibleShopIds = new Set(Object.values(state.playerShops.shops)
        .filter((shop) => shop.visibility === "public")
        .map((shop) => shop.id));
    return Object.values(state.playerShops.listings)
        .filter((listing) => visibleShopIds.has(listing.shopId))
        .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function claimPlayerShopEarnings(player) {
    const playerId = getPlayerId(player);
    const buckets = state.playerShops.earningsByPlayerId[playerId];
    if (!buckets || Object.keys(buckets).length === 0) {
        return { ok: false, message: "No pending shop earnings." };
    }
    let claimedTotal = 0;
    const objectiveLines = [];
    for (const [objective, amountRaw] of Object.entries(buckets)) {
        const amount = Math.max(0, Math.floor(Number(amountRaw ?? 0)));
        if (amount <= 0)
            continue;
        const current = getScore(player, objective);
        if (current === undefined)
            continue;
        if (!setScore(player, objective, current + amount))
            continue;
        claimedTotal += amount;
        objectiveLines.push(`${amount} ${objective}`);
        delete buckets[objective];
    }
    if (Object.keys(buckets).length === 0) {
        delete state.playerShops.earningsByPlayerId[playerId];
    }
    savePlayerShops();
    if (claimedTotal <= 0)
        return { ok: false, message: "Could not claim earnings (missing objective)." };
    return { ok: true, message: `Claimed: ${objectiveLines.join(", ")}` };
}
function notifySaleIfOnline(sellerPlayerId, text) {
    const online = world.getAllPlayers().find((entry) => getPlayerId(entry) === sellerPlayerId);
    if (!online)
        return;
    tell(online, text);
}
function purchaseListing(buyer, listing) {
    if (!state.playerShops.config.enabled)
        return { ok: false, message: "Player shops are disabled." };
    if (listing.quantity <= 0)
        return { ok: false, message: "Listing is out of stock." };
    if (listingLocks.has(listing.id))
        return { ok: false, message: "Listing is currently being processed." };
    if (listing.sellerPlayerId === getPlayerId(buyer))
        return { ok: false, message: "You cannot buy your own listing." };
    listingLocks.add(listing.id);
    try {
        const objective = listing.currencyObjective;
        const buyerBalance = getScore(buyer, objective);
        if (buyerBalance === undefined)
            return { ok: false, message: `Missing scoreboard objective "${objective}".` };
        const totalPrice = Math.max(1, Math.floor(listing.pricePerUnit * listing.quantity));
        if (buyerBalance < totalPrice)
            return { ok: false, message: `You need ${totalPrice} ${objective}.` };
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
        listing.quantity -= 1;
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
            notifySaleIfOnline(listing.sellerPlayerId, `§a${buyer.name} bought 1x ${listing.title} for ${listing.pricePerUnit} ${objective}.`);
        }
        return { ok: true, message: `Purchased ${listing.quantity}x ${listing.title} for ${totalPrice} ${objective}.` };
    }
    finally {
        listingLocks.delete(listing.id);
    }
}
async function openListingCreateFlow(player, shop) {
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
    const picker = new ActionFormData().title("Create Listing").body("Select an item stack from your inventory.");
    for (const entry of inventory.slice(0, 28)) {
        const stack = entry.stack;
        picker.button(`Slot ${entry.slotIndex + 1}: ${stack.nameTag?.trim() || stack.typeId} x${stack.amount}`, ICONS.menu);
    }
    picker.button("Back", ICONS.back);
    const chosen = await picker.show(player).catch(() => undefined);
    if (!chosen || chosen.canceled || chosen.selection === undefined)
        return;
    if (chosen.selection >= inventory.length)
        return;
    const selectedEntry = inventory[chosen.selection];
    if (!selectedEntry)
        return;
    if (!state.playerShops.config.allowCustomItems && hasCustomItemData(selectedEntry.stack)) {
        tell(player, "Custom item listings are disabled by admin config.");
        return;
    }
    const modal = new ModalFormData()
        .title("Create Listing")
        .textField("Title", selectedEntry.stack.nameTag?.trim() || selectedEntry.stack.typeId, { defaultValue: selectedEntry.stack.nameTag?.trim() || selectedEntry.stack.typeId })
        .textField("Category (optional)", "blocks", { defaultValue: "" })
        .textField("Quantity to sell", String(selectedEntry.stack.amount), { defaultValue: String(selectedEntry.stack.amount) })
        .textField("Price per unit", "100", { defaultValue: "100" })
        .submitButton("Create");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues)
        return;
    const title = String(result.formValues[0] ?? "").trim() || selectedEntry.stack.typeId;
    const category = String(result.formValues[1] ?? "").trim() || undefined;
    const quantity = Math.max(1, Math.min(selectedEntry.stack.amount, Math.floor(Number(result.formValues[2] ?? selectedEntry.stack.amount))));
    const rawPrice = Math.floor(Number(result.formValues[3] ?? 0));
    const pricePerUnit = Math.max(Math.max(1, state.playerShops.config.minPricePerUnit), Math.min(Math.max(1, state.playerShops.config.maxPricePerUnit), rawPrice));
    const currencyObjective = resolveCurrencyObjective(shop);
    const escrowed = removeQuantityFromSlot(player, selectedEntry.slotIndex, quantity);
    if (!escrowed) {
        tell(player, "Could not remove the selected item.");
        return;
    }
    escrowed.amount = quantity;
    const listingId = `listing:${shop.id}:${nowMs()}:${Math.random().toString(36).slice(2, 8)}`;
    const listing = {
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
            if (leftover)
                player.dimension.spawnItem(leftover, player.location);
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
async function openListingCancelFlow(player, shop) {
    compactShopListings(shop);
    if (shop.listingIds.length === 0) {
        tell(player, "No listings to cancel.");
        return;
    }
    const menu = new ActionFormData().title("Cancel Listing");
    for (const listingId of shop.listingIds) {
        const listing = findListingById(listingId);
        if (!listing)
            continue;
        menu.button(`${listing.title} (${listing.pricePerUnit} ${listing.currencyObjective})`, ICONS.delete);
    }
    menu.button("Back", ICONS.back);
    const response = await menu.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined)
        return;
    if (response.selection >= shop.listingIds.length)
        return;
    const listingId = shop.listingIds[response.selection];
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
async function openShopSettingsFlow(player, shop) {
    const modal = new ModalFormData()
        .title("My Shop Settings")
        .textField("Title", "My Shop", { defaultValue: shop.title })
        .textField("Description", "optional", { defaultValue: shop.description ?? "" })
        .toggle("Public", { defaultValue: shop.visibility === "public" })
        .textField("Currency objective", shop.currencyObjective, { defaultValue: shop.currencyObjective })
        .submitButton("Save");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues)
        return;
    shop.title = String(result.formValues[0] ?? shop.title).trim() || shop.title;
    shop.description = String(result.formValues[1] ?? "").trim() || undefined;
    shop.visibility = Boolean(result.formValues[2]) ? "public" : "private";
    shop.updatedAt = nowMs();
    savePlayerShops();
    tell(player, "Shop settings saved.");
}
export async function openMyPlayerShop(player) {
    if (!state.playerShops.config.enabled) {
        tell(player, "Player shops are disabled.");
        return;
    }
    const shop = getOrCreateOwnedShop(player);
    while (true) {
        compactShopListings(shop);
        const pending = state.playerShops.earningsByPlayerId[getPlayerId(player)] ?? {};
        const pendingTotal = Object.values(pending).reduce((sum, value) => sum + Math.max(0, Math.floor(value)), 0);
        const menu = new ActionFormData()
            .title(shop.title)
            .body([
            `Listings: ${shop.listingIds.length}`,
            `Visibility: ${shop.visibility}`,
            `Currency: ${shop.currencyObjective}`,
            `Pending earnings: ${pendingTotal}`,
            "Select an item stack from your inventory to create a listing.",
        ].join("\n"))
            .button("Create Listing", ICONS.confirm)
            .button("Cancel Listing", ICONS.delete)
            .button("Shop Settings", ICONS.settings)
            .button("Claim Earnings", ICONS.shop)
            .button("Browse Marketplace", ICONS.menu)
            .button("Back", ICONS.back);
        const response = await menu.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection === 0) {
            await openListingCreateFlow(player, shop);
            continue;
        }
        if (response.selection === 1) {
            await openListingCancelFlow(player, shop);
            continue;
        }
        if (response.selection === 2) {
            await openShopSettingsFlow(player, shop);
            continue;
        }
        if (response.selection === 3) {
            const result = claimPlayerShopEarnings(player);
            tell(player, result.ok ? result.message : `§e${result.message}`);
            continue;
        }
        if (response.selection === 4) {
            await openPlayerMarketplace(player);
            continue;
        }
        return;
    }
}
export async function openPlayerMarketplace(player) {
    if (!state.playerShops.config.enabled) {
        tell(player, "Player shops are disabled.");
        return;
    }
    while (true) {
        const listings = marketplaceListings();
        const menu = new ActionFormData().title("Player Marketplace").body(`Listings: ${listings.length}`);
        for (const listing of listings) {
            menu.button(`${listing.title} x${listing.quantity} - ${listing.pricePerUnit} each`, ICONS.shop);
        }
        menu.button("Back", ICONS.back);
        const response = await menu.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection >= listings.length)
            return;
        const listing = listings[response.selection];
        const sellerName = resolvePlayerNameById(listing.sellerPlayerId, listing.sellerName);
        const preview = new ActionFormData()
            .title(listing.title)
            .body([
            `Seller: ${sellerName}`,
            `Quantity: ${listing.quantity}`,
            `Price each: ${listing.pricePerUnit} ${listing.currencyObjective}`,
            `Total: ${listing.pricePerUnit * listing.quantity} ${listing.currencyObjective}`,
            `Category: ${listing.category ?? "uncategorized"}`,
            `Item: ${listing.item.itemId}`,
            listing.item.nameTag ? `Name: ${listing.item.nameTag}` : "",
            listing.item.lore && listing.item.lore.length > 0 ? `Lore: ${listing.item.lore.slice(0, 3).join(" | ")}` : "",
        ].filter((line) => line.length > 0).join("\n"))
            .button("Buy Listing", ICONS.buy)
            .button("Back", ICONS.back);
        const confirm = await preview.show(player).catch(() => undefined);
        if (!confirm || confirm.canceled || confirm.selection === undefined)
            continue;
        if (confirm.selection !== 0)
            continue;
        const result = purchaseListing(player, listing);
        tell(player, result.ok ? result.message : `§c${result.message}`);
    }
}
export async function openPlayerShopAdmin(player) {
    if (!isOperator(player)) {
        tell(player, "Operator required.");
        return;
    }
    while (true) {
        const config = state.playerShops.config;
        const modal = new ModalFormData()
            .title("Player Shop Settings")
            .toggle("Enabled", { defaultValue: config.enabled })
            .textField("Default currency objective", "money", { defaultValue: config.defaultCurrencyObjective })
            .toggle("Allow custom items", { defaultValue: config.allowCustomItems })
            .textField("Min price per unit", "1", { defaultValue: String(config.minPricePerUnit) })
            .textField("Max price per unit", "1000000", { defaultValue: String(config.maxPricePerUnit) })
            .textField("Tax percent", "0", { defaultValue: String(config.taxPercent) })
            .textField("Max listings per shop", "32", { defaultValue: String(config.maxListingsPerShop) })
            .toggle("Default public visibility", { defaultValue: config.defaultVisibility === "public" })
            .toggle("Announce sales", { defaultValue: config.announceSales })
            .submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues)
            return;
        config.enabled = Boolean(result.formValues[0]);
        config.defaultCurrencyObjective = String(result.formValues[1] ?? config.defaultCurrencyObjective).trim() || config.defaultCurrencyObjective;
        config.allowCustomItems = Boolean(result.formValues[2]);
        config.minPricePerUnit = Math.max(1, Math.floor(Number(result.formValues[3] ?? config.minPricePerUnit)));
        config.maxPricePerUnit = Math.max(config.minPricePerUnit, Math.floor(Number(result.formValues[4] ?? config.maxPricePerUnit)));
        config.taxPercent = Math.max(0, Math.floor(Number(result.formValues[5] ?? config.taxPercent)));
        config.maxListingsPerShop = Math.max(1, Math.floor(Number(result.formValues[6] ?? config.maxListingsPerShop)));
        config.defaultVisibility = Boolean(result.formValues[7]) ? "public" : "private";
        config.announceSales = Boolean(result.formValues[8]);
        savePlayerShops();
        tell(player, "Player shop config saved.");
        return;
    }
}
