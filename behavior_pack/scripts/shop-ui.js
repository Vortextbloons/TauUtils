import { EntityComponentTypes, ItemComponentTypes, ItemStack, EnchantmentTypes } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ICONS } from "./tau-models";
import { canonicalShopId, findShopProfile, getInventoryContainer, getScore, normalizeCategory, getProfileCategories, setScore, state, saveShops, tell, } from "./storage";
export async function openShopProfile(player, profileId) {
    await showShopFront(player, canonicalShopId(profileId));
}
export async function openShopEditor(player, profileId) {
    await showShopItemEditor(player, canonicalShopId(profileId));
}
function iconForShopItem(item) {
    if (item.displayName && item.displayName.trim().length > 0)
        return undefined;
    return item.itemId?.trim() || undefined;
}
function shopLabel(item) {
    return item.label?.trim() || item.itemId;
}
function shopItemKey(item) {
    return item.id?.trim() || `${item.itemId}::${item.label?.trim() || item.displayName?.trim() || ""}::${item.category?.trim() || ""}`;
}
function ensureShopItemId(item, profileId, index) {
    if (item.id && item.id.trim().length > 0)
        return item.id;
    const generated = `${profileId}:${index}:${item.itemId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
        .toLowerCase()
        .replace(/[^a-z0-9:_-]+/g, "_");
    item.id = generated;
    return generated;
}
function getShopItemByKey(profile, key) {
    return profile.items.find((item, index) => ensureShopItemId(item, profile.id, index) === key);
}
function normalizeItemId(value) {
    const trimmed = String(value ?? "").trim().toLowerCase();
    return trimmed.startsWith("minecraft:") ? trimmed.slice(10) : trimmed;
}
function splitList(raw) {
    return String(raw ?? "")
        .split(/[\n|]/g)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}
function parseEnchantments(raw) {
    const entries = String(raw ?? "")
        .split(/[,\n;]/g)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const result = [];
    for (const entry of entries) {
        const [idRaw, levelRaw] = entry.split("=", 2);
        const id = String(idRaw ?? "").trim();
        const level = Math.max(1, Math.floor(Number(String(levelRaw ?? "1").trim())));
        if (!id)
            continue;
        result.push({ id, level });
    }
    return result;
}
function formatEnchantments(enchantments) {
    return (enchantments ?? []).map((entry) => `${entry.id}=${entry.level}`).join(", ");
}
function normalizeItemStackDefinition(def) {
    return {
        itemId: def.itemId.trim(),
        amount: Math.max(1, Math.floor(def.amount)),
        label: def.label?.trim() || undefined,
        displayName: def.displayName?.trim() || undefined,
        lore: def.lore?.map((line) => line.trim()).filter((line) => line.length > 0),
        enchantments: def.enchantments?.filter((entry) => entry.id.trim().length > 0 && entry.level > 0),
        durability: def.durability,
        maxDurability: def.maxDurability,
        customData: def.customData,
    };
}
function parseItemStackDefinitionLine(raw) {
    const parts = raw.split("|").map((part) => part.trim());
    const itemId = parts[0] ?? "";
    if (!itemId)
        return undefined;
    const amount = Math.max(1, Math.floor(Number(parts[1] ?? "1")));
    const label = parts[2] || undefined;
    const lore = splitList(parts[3]);
    const enchantments = parseEnchantments(parts[4]);
    return normalizeItemStackDefinition({ itemId, amount, label, displayName: label, lore, enchantments });
}
function formatItemStackDefinitionLine(def) {
    return [
        def.itemId,
        String(def.amount),
        def.label ?? def.displayName ?? "",
        (def.lore ?? []).join("\n"),
        formatEnchantments(def.enchantments),
    ].join("|");
}
function getItemLore(stack) {
    return stack.getLore().map((line) => String(line).trim()).filter((line) => line.length > 0);
}
function isProtectedCrateKey(stack) {
    for (const line of getItemLore(stack)) {
        if (line.startsWith("§0[TAU_CRATE:"))
            return true;
    }
    return false;
}
function getItemEnchantments(stack) {
    const component = stack.getComponent(ItemComponentTypes.Enchantable);
    const enchantments = component?.getEnchantments() ?? [];
    return enchantments
        .map((entry) => ({ id: entry.type.id, level: entry.level }))
        .sort((a, b) => a.id.localeCompare(b.id));
}
function getEnchantmentPreviewText(enchantments) {
    return (enchantments ?? [])
        .map((entry) => `${entry.id} ${entry.level}`)
        .join(", ");
}
function createStackFromDefinition(def, multiplier = 1) {
    const amount = Math.max(1, Math.floor(def.amount * multiplier));
    const stack = new ItemStack(def.itemId, amount);
    if (def.displayName)
        stack.nameTag = def.displayName;
    if (def.lore && def.lore.length > 0)
        stack.setLore(def.lore);
    const component = stack.getComponent(ItemComponentTypes.Enchantable);
    if (component && def.enchantments && def.enchantments.length > 0) {
        const valid = [];
        let needsFallback = false;
        for (const entry of def.enchantments) {
            const type = EnchantmentTypes.get(entry.id);
            if (type) {
                const level = Math.max(1, Math.floor(entry.level));
                valid.push({ type, level });
                if (level > type.maxLevel)
                    needsFallback = true;
            }
        }
        if (valid.length > 0) {
            try {
                component.addEnchantments(valid);
            }
            catch {
                // Ignore incompatible enchantments
                needsFallback = true;
            }
        }
        if (needsFallback) {
            stack.setDynamicProperty("tau:enchants", JSON.stringify(def.enchantments));
        }
    }
    if (def.durability !== undefined && def.maxDurability !== undefined) {
        const durComp = stack.getComponent(ItemComponentTypes.Durability);
        if (durComp) {
            try {
                durComp.damage = Math.max(0, Math.min(def.maxDurability, def.durability));
            }
            catch {
                // Durability not supported for this item type
            }
        }
    }
    if (def.customData) {
        try {
            const data = JSON.parse(def.customData);
            if (data.canPlaceOn) {
                const placeComp = stack.getComponent("minecraft:can_place_on");
                if (placeComp)
                    placeComp.blocks = data.canPlaceOn;
            }
            if (data.canDestroy) {
                const destroyComp = stack.getComponent("minecraft:can_destroy");
                if (destroyComp)
                    destroyComp.blocks = data.canDestroy;
            }
        }
        catch {
            // Invalid custom data, skip
        }
    }
    return stack;
}
function purchaseStacksAreSingle(def) {
    const itemId = normalizeItemId(def.itemId);
    return itemId === "enchanted_book" || (def.enchantments?.length ?? 0) > 0;
}
function getMaxStackAmount(itemId) {
    try {
        return Math.max(1, new ItemStack(itemId, 1).maxAmount);
    }
    catch {
        return 64;
    }
}
function buildChunkedStacks(def, totalAmount) {
    const stacks = [];
    const maxAmount = getMaxStackAmount(def.itemId);
    let remaining = Math.max(1, Math.floor(totalAmount));
    while (remaining > 0) {
        const amount = Math.min(maxAmount, remaining);
        stacks.push(createStackFromDefinition({ ...def, amount }, 1));
        remaining -= amount;
    }
    return stacks;
}
function itemMatchesDefinition(stack, def) {
    if (isProtectedCrateKey(stack))
        return false;
    return normalizeItemId(stack.typeId) === normalizeItemId(def.itemId);
}
function countMatchingItems(player, def) {
    const container = getInventoryContainer(player);
    if (!container)
        return 0;
    let total = 0;
    for (let slot = 0; slot < container.size; slot++) {
        const stack = container.getItem(slot);
        if (!stack || !itemMatchesDefinition(stack, def))
            continue;
        total += stack.amount;
    }
    return total;
}
function removeMatchingItems(player, def, amount) {
    const container = getInventoryContainer(player);
    if (!container)
        return false;
    let remaining = amount;
    for (let slot = 0; slot < container.size && remaining > 0; slot++) {
        const stack = container.getItem(slot);
        if (!stack || !itemMatchesDefinition(stack, def))
            continue;
        if (stack.amount <= remaining) {
            remaining -= stack.amount;
            container.setItem(slot, undefined);
        }
        else {
            stack.amount -= remaining;
            remaining = 0;
            container.setItem(slot, stack);
        }
    }
    return remaining === 0;
}
function itemRequiresKitMode(item) {
    return (item.bundle?.length ?? 0) > 0;
}
function singleStackDefinitionFromItem(item) {
    return normalizeItemStackDefinition({
        itemId: item.itemId,
        amount: 1,
        label: item.label,
        displayName: item.displayName,
        lore: item.lore,
        enchantments: item.enchantments,
    });
}
function buildItemStacksForPurchase(item, quantity) {
    if (itemRequiresKitMode(item)) {
        const stacks = [];
        for (const entry of item.bundle ?? []) {
            stacks.push(...buildChunkedStacks(entry, entry.amount * quantity));
        }
        return stacks;
    }
    if (purchaseStacksAreSingle(item)) {
        const stacks = [];
        for (let index = 0; index < quantity; index++) {
            stacks.push(createStackFromDefinition({
                itemId: item.itemId,
                amount: 1,
                label: item.label,
                displayName: item.displayName,
                lore: item.lore,
                enchantments: item.enchantments,
                durability: item.durability,
                maxDurability: item.maxDurability,
                customData: item.customData,
            }, 1));
        }
        return stacks;
    }
    return buildChunkedStacks({
        itemId: item.itemId,
        amount: 1,
        label: item.label,
        displayName: item.displayName,
        lore: item.lore,
        enchantments: item.enchantments,
        durability: item.durability,
        maxDurability: item.maxDurability,
        customData: item.customData,
    }, quantity);
}
function captureHeldItemDefinition(held, amount) {
    const durComp = held.getComponent(ItemComponentTypes.Durability);
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
function snapshotContainer(container) {
    const snapshot = [];
    for (let slot = 0; slot < container.size; slot++) {
        const stack = container.getItem(slot);
        snapshot.push(stack ? stack.clone() : undefined);
    }
    return snapshot;
}
function restoreContainer(container, snapshot) {
    for (let slot = 0; slot < snapshot.length; slot++) {
        container.setItem(slot, snapshot[slot]?.clone());
    }
}
function getItemInstanceDefinition(item) {
    return normalizeItemStackDefinition({
        itemId: item.itemId,
        amount: 1,
        displayName: item.displayName,
        lore: item.lore,
        enchantments: item.enchantments,
    });
}
function getItemInstanceCount(player, item) {
    return countMatchingItems(player, getItemInstanceDefinition(item));
}
function removeItemInstance(player, item, quantity) {
    if (quantity <= 0)
        return true;
    return removeMatchingItems(player, getItemInstanceDefinition(item), quantity);
}
function promptHeldItemPricing(player, held, preset) {
    return new ModalFormData()
        .title(`Use Held Item: ${held.typeId}`)
        .textField("Shop label", held.typeId, { defaultValue: preset?.label ?? held.typeId })
        .textField("Display name (optional)", "Shown on item", { defaultValue: preset?.displayName ?? held.nameTag ?? "" })
        .textField("Category", "Tools", { defaultValue: preset?.category ?? "" })
        .textField("Amount to use", "1", { defaultValue: String(preset?.quantities?.[0] ?? Math.max(1, held.amount)) })
        .toggle("Can be bought", { defaultValue: (preset?.buyPrice ?? 0) > 0 })
        .textField("Buy price", "0", { defaultValue: String(preset?.buyPrice ?? 0) })
        .toggle("Can be sold", { defaultValue: (preset?.sellPrice ?? 0) > 0 })
        .textField("Sell price", "0", { defaultValue: String(preset?.sellPrice ?? 0) })
        .textField("Extra quantities (comma-separated)", "1,16,64", { defaultValue: preset?.quantities?.join(",") ?? "1,16,64" })
        .submitButton("Save");
}
function categoryList(profile) {
    const categories = new Set();
    for (const item of profile.items)
        categories.add(normalizeCategory(item.category));
    for (const cat of getProfileCategories(profile.id))
        categories.add(normalizeCategory(cat));
    return [...categories].sort();
}
function itemsInCategory(profile, category) {
    let items = profile.items.filter((item) => normalizeCategory(item.category) === category);
    const sortMode = profile.sortMode ?? "default";
    items = sortShopItems(items, sortMode);
    return items;
}
function sortShopItems(items, mode) {
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
function normalizeShopProfileItems(profile) {
    let changed = false;
    profile.items.forEach((item, index) => {
        if (!item.id || item.id.trim().length === 0) {
            ensureShopItemId(item, profile.id, index);
            changed = true;
        }
    });
    if (changed)
        saveShops();
}
function moveCategoryItems(profile, sourceCategory, targetProfile, targetCategory) {
    const nextCategory = targetCategory?.trim() || sourceCategory;
    const movingItems = [];
    profile.items = profile.items.filter((item) => {
        if (normalizeCategory(item.category) !== sourceCategory)
            return true;
        item.category = nextCategory;
        movingItems.push(item);
        return false;
    });
    for (const item of movingItems) {
        ensureShopItemId(item, targetProfile.id, targetProfile.items.length);
        targetProfile.items.push(item);
    }
    profile.categories = (profile.categories ?? []).filter((entry) => entry !== sourceCategory);
    targetProfile.categories ?? (targetProfile.categories = []);
    if (!targetProfile.categories.includes(nextCategory))
        targetProfile.categories.push(nextCategory);
    saveShops();
}
async function moveCategoryToProfile(player, sourceProfile, category) {
    const profiles = Object.values(state.shops).filter((profile) => profile.id !== sourceProfile.id).sort((a, b) => a.id.localeCompare(b.id));
    const menu = new ActionFormData()
        .title(`Move Category: ${category}`)
        .body("Choose a destination profile.")
        .button("Create new profile", ICONS.confirm);
    for (const profile of profiles)
        menu.button(profile.id, ICONS.shop);
    menu.button("Cancel", ICONS.back);
    const response = await menu.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined)
        return;
    if (response.selection === 0) {
        const modal = new ModalFormData()
            .title("New Shop Profile")
            .textField("Profile ID", "gens")
            .textField("Currency objective", sourceProfile.currencyObjective, { defaultValue: sourceProfile.currencyObjective })
            .textField("Destination category name", category, { defaultValue: category })
            .submitButton("Create and Move");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues)
            return;
        const profileId = String(result.formValues[0] ?? "").trim();
        const objective = String(result.formValues[1] ?? "").trim() || sourceProfile.currencyObjective;
        const destinationCategory = String(result.formValues[2] ?? "").trim() || category;
        if (!profileId) {
            tell(player, "Profile ID is required.");
            return;
        }
        const targetProfile = state.shops[profileId] ?? {
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
    const profileIndex = response.selection - 1;
    if (profileIndex < 0 || profileIndex >= profiles.length)
        return;
    const targetProfile = profiles[profileIndex];
    const modal = new ModalFormData()
        .title("Move Category")
        .textField("Destination category name", category, { defaultValue: category })
        .submitButton("Move");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues)
        return;
    const destinationCategory = String(result.formValues[0] ?? "").trim() || category;
    moveCategoryItems(sourceProfile, category, targetProfile, destinationCategory);
    tell(player, `Moved category ${category} to ${targetProfile.id}.`);
}
async function showCategoryManager(player, profile) {
    while (true) {
        const categories = categoryList(profile);
        const menu = new ActionFormData()
            .title(`Categories: ${profile.id}`)
            .body(`Count: ${categories.length}`)
            .button("Add category", ICONS.confirm);
        for (const category of categories)
            menu.button(category, ICONS.menu);
        menu.button("Back", ICONS.back);
        const response = await menu.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection === 0) {
            const modal = new ModalFormData()
                .title("Add Category")
                .textField("Name", "Tools")
                .submitButton("Save");
            const result = await modal.show(player).catch(() => undefined);
            if (!result || result.canceled || !result.formValues)
                continue;
            const name = String(result.formValues[0] ?? "").trim();
            if (!name)
                continue;
            profile.categories ?? (profile.categories = []);
            if (!profile.categories.includes(name))
                profile.categories.push(name);
            saveShops();
            tell(player, `Added category ${name}.`);
            continue;
        }
        const index = response.selection - 1;
        if (index >= 0 && index < categories.length) {
            await showCategoryEditor(player, profile, categories[index]);
            continue;
        }
        return;
    }
}
async function showCategoryEditor(player, profile, category) {
    while (true) {
        const items = itemsInCategory(profile, category);
        const menu = new ActionFormData()
            .title(`${profile.id} / ${category}`)
            .body(`Items: ${items.length}`)
            .button("Rename category", ICONS.edit)
            .button("Move category", ICONS.shop)
            .button("Delete category", ICONS.delete)
            .button("Add held item", ICONS.binding)
            .button("Add item", ICONS.confirm);
        for (const item of items)
            menu.button(`${shopLabel(item)} (${item.buyPrice}/${item.sellPrice})`, iconForShopItem(item));
        menu.button("Back", ICONS.back);
        const response = await menu.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection === 0) {
            const modal = new ModalFormData().title("Rename Category").textField("Name", category).submitButton("Save");
            const result = await modal.show(player).catch(() => undefined);
            if (!result || result.canceled || !result.formValues)
                continue;
            const nextName = String(result.formValues[0] ?? "").trim();
            if (!nextName)
                continue;
            for (const item of profile.items) {
                if (normalizeCategory(item.category) === category)
                    item.category = nextName;
            }
            profile.categories = (profile.categories ?? []).filter((c) => c !== category);
            if (!profile.categories.includes(nextName))
                profile.categories.push(nextName);
            saveShops();
            tell(player, `Renamed category to ${nextName}.`);
            category = nextName;
            continue;
        }
        if (response.selection === 1) {
            await moveCategoryToProfile(player, profile, category);
            return;
        }
        if (response.selection === 2) {
            for (const item of profile.items) {
                if (normalizeCategory(item.category) === category)
                    item.category = undefined;
            }
            profile.categories = (profile.categories ?? []).filter((c) => c !== category);
            saveShops();
            tell(player, `Deleted category ${category}.`);
            return;
        }
        if (response.selection === 3) {
            await addHeldItemFlow(player, profile, category);
            continue;
        }
        if (response.selection === 4) {
            await addShopItemFlow(player, profile, category);
            continue;
        }
        const index = response.selection - 5;
        if (index >= 0 && index < items.length) {
            await showShopItemActions(player, profile, profile.items.indexOf(items[index]));
            continue;
        }
        return;
    }
}
async function addShopItemFlow(player, profile, category) {
    const modal = new ModalFormData()
        .title("Add Shop Item")
        .textField("Item ID", "minecraft:iron_ingot")
        .textField("Display name (optional)", "Iron Ingot")
        .textField("Category (optional)", category ?? "Tools")
        .toggle("Can be bought", { defaultValue: true })
        .textField("Buy price", "30", { defaultValue: "30" })
        .toggle("Can be sold", { defaultValue: true })
        .textField("Sell price", "15", { defaultValue: "15" })
        .textField("Quantities (comma-separated)", "1,16,64", { defaultValue: "1,16,64" })
        .submitButton("Add");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues)
        return;
    const itemId = String(result.formValues[0] ?? "").trim();
    const displayName = String(result.formValues[1] ?? "").trim();
    const cat = String(result.formValues[2] ?? "").trim();
    const canBuy = Boolean(result.formValues[3]);
    const buyPrice = Math.max(0, Math.floor(Number(result.formValues[4] ?? 0)));
    const canSell = Boolean(result.formValues[5]);
    const sellPrice = Math.max(0, Math.floor(Number(result.formValues[6] ?? 0)));
    const quantities = cleanQuantities(String(result.formValues[7] ?? "1"));
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
async function addHeldItemFlow(player, profile, category) {
    const held = getHeldItem(player);
    if (!held) {
        tell(player, "Hold an item first.");
        return;
    }
    const modal = promptHeldItemPricing(player, held, {
        category,
        quantities: [Math.max(1, held.amount)],
    });
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues)
        return;
    profile.items.push(normalizeHeldShopItemResult(held, result, category));
    saveShops();
    tell(player, `Added held item ${held.typeId}.`);
}
function summarizeKitBundle(bundle) {
    if (bundle.length === 0)
        return "No held items added yet.";
    return bundle
        .map((entry, index) => {
        const name = entry.displayName ?? entry.itemId;
        const suffix = entry.enchantments && entry.enchantments.length > 0 ? ` (${formatEnchantments(entry.enchantments)})` : "";
        return `${index + 1}. ${name} x${entry.amount}${suffix}`;
    })
        .join("\n");
}
function getKitDraft(profile) {
    return profile.kitDraft ?? {
        displayName: "",
        category: "Kits",
        buyPrice: 100,
        quantities: [1],
        bundle: [],
    };
}
function saveKitDraft(profile, draft) {
    profile.kitDraft = draft;
    saveShops();
}
async function promptKitDetails(player, current) {
    const modal = new ModalFormData()
        .title("Kit Details")
        .textField("Kit name", "PvP Kit", { defaultValue: current.displayName })
        .textField("Category", "Kits", { defaultValue: current.category })
        .textField("Buy price", "100", { defaultValue: String(current.buyPrice) })
        .textField("Quantities", "1", { defaultValue: current.quantities.join(",") })
        .submitButton("Save");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues)
        return undefined;
    const displayName = String(result.formValues[0] ?? "").trim();
    const category = String(result.formValues[1] ?? "").trim();
    const buyPrice = Math.max(0, Math.floor(Number(result.formValues[2] ?? 0)));
    const quantities = cleanQuantities(String(result.formValues[3] ?? "1"));
    if (!displayName)
        return undefined;
    return {
        displayName,
        category: category || "Kits",
        buyPrice,
        quantities: quantities.length > 0 ? quantities : [1],
    };
}
async function kitBuilderFlow(player, profile, existing, category) {
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
    const draft = {
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
        const menu = new ActionFormData()
            .title(existing ? `Edit Kit: ${draft.displayName || existing.itemId}` : "Add Kit")
            .body([
            `Items: ${draft.bundle.length}`,
            `Name: ${draft.displayName || "(set name)"}`,
            `Category: ${draft.category || "Kits"}`,
            `Buy price: ${draft.buyPrice}`,
            `Can buy: ${draftFlags.canBuy ? "Yes" : "No"}`,
            `Can sell: ${draftFlags.canSell ? "Yes" : "No"}`,
            `Qty options: ${draft.quantities.join(", ")}`,
            "Add held items, then submit.",
            summarizeKitBundle(draft.bundle),
        ].join("\n"))
            .button("Add held item", ICONS.binding)
            .button("Edit details", ICONS.edit)
            .button("Toggle buy/sell", ICONS.settings)
            .button("Remove last", ICONS.delete)
            .button("Clear items", ICONS.cancel)
            .button("Submit", ICONS.confirm)
            .button("Cancel", ICONS.back);
        const response = await menu.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection === 0) {
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
        if (response.selection === 1) {
            const details = await promptKitDetails(player, draft);
            if (!details)
                continue;
            draft.displayName = details.displayName;
            draft.category = details.category;
            draft.buyPrice = details.buyPrice;
            draft.quantities = details.quantities;
            saveKitDraft(profile, draft);
            continue;
        }
        if (response.selection === 2) {
            draftFlags.canBuy = !draftFlags.canBuy;
            draftFlags.canSell = !draftFlags.canSell;
            continue;
        }
        if (response.selection === 3) {
            if (draft.bundle.length === 0)
                continue;
            draft.bundle.pop();
            saveKitDraft(profile, draft);
            continue;
        }
        if (response.selection === 4) {
            draft.bundle = [];
            saveKitDraft(profile, draft);
            continue;
        }
        if (response.selection === 5) {
            if (!draft.displayName.trim()) {
                tell(player, "Kit name is required.");
                continue;
            }
            if (draft.bundle.length === 0) {
                tell(player, "Add at least one held item first.");
                continue;
            }
            const itemId = existing?.itemId ?? `kit:${draft.displayName.toLowerCase().replace(/\s+/g, "_")}`;
            const nextItem = {
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
                if (index >= 0)
                    profile.items[index] = nextItem;
            }
            else {
                profile.items.push(nextItem);
            }
            delete profile.kitDraft;
            saveShops();
            tell(player, `${existing ? "Saved" : "Added"} kit ${draft.displayName}.`);
            return;
        }
        if (response.selection === 6) {
            delete profile.kitDraft;
            saveShops();
            return;
        }
        return;
    }
}
async function addKitItemFlow(player, profile, category) {
    const draft = getKitDraft(profile);
    draft.category = category ?? draft.category;
    profile.kitDraft = draft;
    saveShops();
    await kitBuilderFlow(player, profile, undefined, category);
}
async function editKitItemFlow(player, profile, itemIndex) {
    const item = profile.items[itemIndex];
    if (!item || !item.bundle || item.bundle.length === 0)
        return;
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
function cleanQuantities(raw) {
    return raw
        .split(",")
        .map((v) => Math.max(1, Math.floor(Number(v.trim()))))
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => a - b);
}
function normalizeHeldShopItemResult(held, result, fallbackCategory) {
    if (!result.formValues) {
        return {
            itemId: held.typeId,
            label: held.typeId,
            displayName: undefined,
            category: fallbackCategory || undefined,
            buyPrice: 0,
            sellPrice: 0,
            quantities: [Math.max(1, held.amount)],
        };
    }
    const label = String(result.formValues[0] ?? "").trim();
    const displayName = String(result.formValues[1] ?? "").trim();
    const category = String(result.formValues[2] ?? "").trim();
    const amount = Math.max(1, Math.floor(Number(result.formValues[3] ?? held.amount ?? 1)));
    const canBuy = Boolean(result.formValues[4]);
    const buyPrice = Math.max(0, Math.floor(Number(result.formValues[5] ?? 0)));
    const canSell = Boolean(result.formValues[6]);
    const sellPrice = Math.max(0, Math.floor(Number(result.formValues[7] ?? 0)));
    const extras = cleanQuantities(String(result.formValues[8] ?? ""));
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
async function showCategoryItems(player, profile, category) {
    while (true) {
        const items = itemsInCategory(profile, category);
        const menu = new ActionFormData()
            .title(`${profile.id} / ${category}`)
            .body(`Items: ${items.length}`);
        for (const item of items) {
            menu.button(`${shopLabel(item)} (${item.buyPrice}/${item.sellPrice})`, ICONS.shop);
        }
        menu.button("Back", ICONS.back);
        const response = await menu.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection >= items.length)
            return;
        const item = items[response.selection];
        await openShopTransaction(player, `${profile.id}|key:${shopItemKey(item)}`);
    }
}
async function showShopFront(player, profileId) {
    const profile = findShopProfile(profileId);
    if (!profile) {
        tell(player, `Shop profile "${profileId}" was not found.`);
        return;
    }
    normalizeShopProfileItems(profile);
    while (true) {
        const categories = categoryList(profile);
        const menu = new ActionFormData()
            .title(`Shop: ${profile.id}`)
            .body(`Currency: ${profile.currencyObjective}\nCategories: ${categories.length}`);
        menu.button("All Items", ICONS.shop);
        menu.button("Sell All Sellable", ICONS.sellAll);
        for (const category of categories)
            menu.button(category, ICONS.menu);
        menu.button("Back", ICONS.back);
        const response = await menu.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection === 0) {
            await showCategoryItems(player, profile, "Uncategorized");
            continue;
        }
        if (response.selection === 1) {
            await sellAllSellableItems(player, profile.id);
            continue;
        }
        const categoryIndex = response.selection - 2;
        if (categoryIndex >= 0 && categoryIndex < categories.length) {
            await showCategoryItems(player, profile, categories[categoryIndex]);
            continue;
        }
        return;
    }
}
function getHeldItem(player) {
    const inv = player.getComponent(EntityComponentTypes.Inventory);
    return inv?.container?.getItem(player.selectedSlotIndex);
}
async function applyHeldItemAsShopItem(player, profile, itemIndex) {
    const held = getHeldItem(player);
    if (!held) {
        tell(player, "No item held in main hand.");
        return;
    }
    const quantity = held.amount > 0 ? held.amount : 1;
    const targetIndex = itemIndex ?? profile.items.findIndex((item) => normalizeItemId(item.itemId) === normalizeItemId(held.typeId));
    const existing = targetIndex >= 0 ? profile.items[targetIndex] : undefined;
    const lore = held.getLore();
    const newItem = {
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
    }
    else {
        profile.items.push(newItem);
        tell(player, `Added "${held.typeId}" to shop.`);
    }
    saveShops();
}
async function editShopItem(player, profile, itemIndex) {
    const item = profile.items[itemIndex];
    if (!item)
        return;
    if (item.bundle && item.bundle.length > 0) {
        const mode = await new ActionFormData()
            .title(`Edit Kit: ${shopLabel(item)}`)
            .body(`Buy enabled: ${item.canBuy !== false}\nSell enabled: ${item.canSell !== false}`)
            .button("Toggle buy", ICONS.settings)
            .button("Toggle sell", ICONS.settings)
            .button("Back", ICONS.back)
            .show(player)
            .catch(() => undefined);
        if (!mode || mode.canceled || mode.selection === undefined)
            return;
        if (mode.selection === 0)
            item.canBuy = !(item.canBuy !== false);
        if (mode.selection === 1)
            item.canSell = !(item.canSell !== false);
        saveShops();
        return;
    }
    const modal = new ModalFormData()
        .title(`Edit Item: ${item.itemId}`)
        .textField("Item ID", "minecraft:iron_ingot", { defaultValue: item.itemId })
        .textField("Shop label", "Iron Ingot", {
        defaultValue: item.label ?? item.itemId,
    })
        .textField("Item display name (optional)", "Shown on given item", {
        defaultValue: item.displayName ?? "",
    })
        .textField("Category (optional)", "Tools", {
        defaultValue: item.category ?? "",
    })
        .toggle("Can be bought", { defaultValue: item.canBuy !== false })
        .textField("Buy price", "30", { defaultValue: String(item.buyPrice) })
        .toggle("Can be sold", { defaultValue: item.canSell !== false })
        .textField("Sell price", "15", { defaultValue: String(item.sellPrice) })
        .textField("Quantities (comma-separated)", "1,16,64", {
        defaultValue: item.quantities.join(","),
    })
        .submitButton("Save");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues)
        return;
    const itemId = String(result.formValues[0] ?? "").trim();
    const label = String(result.formValues[1] ?? "").trim();
    const displayName = String(result.formValues[2] ?? "").trim();
    const category = String(result.formValues[3] ?? "").trim();
    const canBuy = Boolean(result.formValues[4]);
    const buyPrice = Math.max(0, Math.floor(Number(result.formValues[5] ?? 0)));
    const canSell = Boolean(result.formValues[6]);
    const sellPrice = Math.max(0, Math.floor(Number(result.formValues[7] ?? 0)));
    const quantities = String(result.formValues[8] ?? "1")
        .split(",")
        .map((v) => Math.max(1, Math.floor(Number(v.trim()))))
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => a - b);
    if (!itemId) {
        tell(player, "Item ID is required.");
        return;
    }
    profile.items[itemIndex] = {
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
async function duplicateShopItem(player, profile, itemIndex) {
    const item = profile.items[itemIndex];
    if (!item)
        return;
    profile.items.push({
        ...item,
        itemId: `${item.itemId}_copy`,
        displayName: item.displayName ? `${item.displayName} Copy` : undefined,
    });
    saveShops();
    tell(player, `Duplicated ${item.itemId}.`);
}
async function moveShopItemToCategory(player, profile, itemIndex) {
    const item = profile.items[itemIndex];
    if (!item)
        return;
    const categories = categoryList(profile);
    const menu = new ActionFormData().title(`Move: ${shopLabel(item)}`);
    for (const category of categories)
        menu.button(category, ICONS.menu);
    menu.button("New category", ICONS.confirm);
    menu.button("Cancel", ICONS.cancel);
    const response = await menu.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined)
        return;
    let target = "";
    if (response.selection < categories.length)
        target = categories[response.selection];
    else if (response.selection === categories.length) {
        const modal = new ModalFormData().title("New Category").textField("Name", "Tools").submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues)
            return;
        target = String(result.formValues[0] ?? "").trim();
    }
    else
        return;
    if (!target)
        return;
    item.category = target;
    saveShops();
    tell(player, `Moved ${item.itemId} to ${target}.`);
}
async function showShopItemActions(player, profile, itemIndex) {
    const item = profile.items[itemIndex];
    if (!item)
        return;
    while (true) {
        const menu = new ActionFormData()
            .title(shopLabel(item))
            .body([
            `Mode: ${item.bundle && item.bundle.length > 0 ? "kit" : "item"}`,
            `Buy: ${item.buyPrice}`,
            `Sell: ${item.bundle && item.bundle.length > 0 ? "N/A" : item.canSell === false ? "Off" : item.sellPrice}`,
            `Category: ${normalizeCategory(item.category)}`,
            item.durability !== undefined ? `Durability: ${item.durability}/${item.maxDurability ?? "?"}` : "",
            item.exactDurability ? "§aExact durability match" : "",
        ].filter(Boolean).join("\n"))
            .button("Edit", ICONS.edit)
            .button("Move category", ICONS.menu)
            .button("Duplicate", ICONS.confirm)
            .button("Advanced Properties", ICONS.settings)
            .button("Delete", ICONS.delete)
            .button("Back", ICONS.back);
        const response = await menu.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection === 0) {
            if (item.bundle && item.bundle.length > 0)
                await editKitItemFlow(player, profile, itemIndex);
            else
                await editShopItem(player, profile, itemIndex);
            return;
        }
        if (response.selection === 1) {
            await moveShopItemToCategory(player, profile, itemIndex);
            return;
        }
        if (response.selection === 2) {
            await duplicateShopItem(player, profile, itemIndex);
            return;
        }
        if (response.selection === 3) {
            await showAdvancedProperties(player, profile, itemIndex);
            continue;
        }
        if (response.selection === 4) {
            profile.items.splice(itemIndex, 1);
            saveShops();
            tell(player, `Deleted ${item.itemId}.`);
            return;
        }
        return;
    }
}
async function showAdvancedProperties(player, profile, itemIndex) {
    const item = profile.items[itemIndex];
    if (!item)
        return;
    const durComp = item.durability !== undefined;
    const exactLabel = item.exactDurability ? "Enabled" : "Disabled";
    const showLabel = item.showEnchantsInPreview ? "Enabled" : "Disabled";
    const durText = durComp ? `${item.durability}/${item.maxDurability ?? "?"}` : "Not set";
    while (true) {
        const form = new ActionFormData()
            .title("Advanced Properties")
            .body([
            `Durability: ${durText}`,
            `Exact Durability Match: ${exactLabel}`,
            `Show Enchants in Preview: ${showLabel}`,
            `Custom Data: ${item.customData ? "Set" : "None"}`,
        ].join("\n"))
            .button("Toggle Exact Durability", ICONS.settings)
            .button("Toggle Show Enchants", ICONS.settings)
            .button("Edit Custom Data", ICONS.edit)
            .button("Back", ICONS.back);
        const response = await form.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection === 0) {
            item.exactDurability = !item.exactDurability;
            saveShops();
            continue;
        }
        if (response.selection === 1) {
            item.showEnchantsInPreview = !item.showEnchantsInPreview;
            saveShops();
            continue;
        }
        if (response.selection === 2) {
            const modal = new ModalFormData()
                .title("Custom Data (JSON)")
                .textField("Data", '{"canPlaceOn": [], "canDestroy": []}', { defaultValue: item.customData ?? "" })
                .submitButton("Save");
            const result = await modal.show(player).catch(() => undefined);
            if (!result || result.canceled || !result.formValues)
                continue;
            const data = String(result.formValues[0] ?? "").trim();
            if (data) {
                try {
                    JSON.parse(data);
                    item.customData = data;
                    saveShops();
                    tell(player, "Custom data saved.");
                }
                catch {
                    tell(player, "§cInvalid JSON. Please check your input.");
                }
            }
            else {
                item.customData = undefined;
                saveShops();
                tell(player, "Custom data cleared.");
            }
            continue;
        }
        return;
    }
}
export async function sellAllSellableItems(player, profileId) {
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
    const sellItems = [];
    let totalGain = 0;
    for (const item of profile.items) {
        if (item.bundle && item.bundle.length > 0)
            continue;
        if (item.canSell === false)
            continue;
        const owned = getItemInstanceCount(player, item);
        if (owned <= 0 || item.sellPrice <= 0)
            continue;
        const total = item.sellPrice * owned;
        totalGain += total;
        sellItems.push({ item, owned, total });
    }
    if (sellItems.length === 0) {
        tell(player, "Nothing sellable was found.");
        return;
    }
    const lines = [];
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
        const confirmForm = new ActionFormData()
            .title("Sell All")
            .body(`Sell these items?\n\n${lines.join("\n")}`)
            .button("§aConfirm Sell", ICONS.sellAll)
            .button("Cancel", ICONS.cancel);
        const response = await confirmForm.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection === 0) {
            for (const entry of sellItems) {
                removeItemInstance(player, entry.item, entry.owned);
            }
            setScore(player, profile.currencyObjective, current + totalGain);
            tell(player, `§aSold all items for §e${totalGain} ${profile.currencyObjective}§a!`);
            return;
        }
        return;
    }
}
export async function openShopTransaction(player, transactionValue) {
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
        tell(player, `Shop item "${itemOrUndefined}" was not found in profile "${profile.id}".`);
        return;
    }
    const title = shopLabel(item);
    const actionForm = new ActionFormData()
        .title(`§l${title}§r`)
        .body([
        `Currency: ${profile.currencyObjective}`,
        `Buy price: ${item.canBuy === false ? "Off" : item.buyPrice}`,
        `Sell price: ${item.bundle && item.bundle.length > 0 ? "N/A" : item.canSell === false ? "Off" : item.sellPrice}`,
        `Qty options: ${item.quantities.join(", ")}`,
    ].join("\n"));
    const operations = [];
    for (const qty of item.quantities) {
        const buyCost = item.buyPrice * qty;
        if (item.canBuy !== false && item.buyPrice > 0) {
            actionForm.button(`Buy ${qty} (-${buyCost})`, ICONS.buy);
            operations.push({ mode: "buy", qty });
        }
        if (item.bundle && item.bundle.length > 0) {
            continue;
        }
        if (item.canSell !== false && item.sellPrice > 0) {
            const sellGain = item.sellPrice * qty;
            actionForm.button(`Sell ${qty} (+${sellGain})`, ICONS.sell);
            operations.push({ mode: "sell", qty });
        }
    }
    if (item.canSell !== false && item.sellPrice > 0 && !(item.bundle && item.bundle.length > 0)) {
        actionForm.button("Sell All This Item", ICONS.sellAll);
        operations.push({ mode: "sell_all_item", qty: 0 });
    }
    actionForm.button("Close", ICONS.cancel);
    const response = await actionForm.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined)
        return;
    if (response.selection >= operations.length)
        return;
    const op = operations[response.selection];
    if (op.mode === "buy") {
        const current = getScore(player, profile.currencyObjective);
        if (current === undefined) {
            tell(player, `Missing scoreboard objective "${profile.currencyObjective}".`);
            return;
        }
        const cost = item.buyPrice * op.qty;
        if (current < cost) {
            tell(player, `You need ${cost} ${profile.currencyObjective} to buy ${op.qty}.`);
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
            if (!leftover)
                continue;
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
    }
    else if (op.mode === "sell") {
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
    }
    else {
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
export async function showShopProfilesEditor(player) {
    while (true) {
        const ids = Object.keys(state.shops);
        const form = new ActionFormData()
            .title("Shop Profiles")
            .body(`Profiles: ${ids.length}`)
            .button("Create new profile", ICONS.confirm)
            .button("Delete profile", ICONS.delete)
            .button("Back", ICONS.back);
        for (const id of ids) {
            form.button(id, ICONS.shop);
        }
        const response = await form.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection === 0) {
            const modal = new ModalFormData()
                .title("Create Shop Profile")
                .textField("Profile ID", "default", { defaultValue: "default" })
                .textField("Currency objective", "money", { defaultValue: "money" })
                .submitButton("Create");
            const result = await modal.show(player).catch(() => undefined);
            if (!result || result.canceled || !result.formValues)
                continue;
            const id = String(result.formValues[0] ?? "").trim();
            const objective = String(result.formValues[1] ?? "").trim();
            if (!id || !objective)
                continue;
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
        if (response.selection === 1) {
            if (ids.length === 0) {
                tell(player, "No profiles to delete.");
                continue;
            }
            const picker = new ActionFormData().title("Delete Shop Profile");
            for (const id of ids)
                picker.button(id, ICONS.delete);
            picker.button("Cancel", ICONS.cancel);
            const pick = await picker.show(player).catch(() => undefined);
            if (!pick || pick.canceled || pick.selection === undefined)
                continue;
            if (pick.selection >= ids.length)
                continue;
            const id = ids[pick.selection];
            delete state.shops[id];
            saveShops();
            tell(player, `Deleted profile "${id}".`);
            continue;
        }
        const profileIndex = response.selection - 3;
        if (profileIndex >= 0 && profileIndex < ids.length) {
            await showShopItemEditor(player, ids[profileIndex]);
            continue;
        }
        return;
    }
}
async function showShopItemEditor(player, profileId) {
    const profile = findShopProfile(profileId);
    if (!profile) {
        tell(player, `Shop profile "${profileId}" was not found.`);
        return;
    }
    while (true) {
        const categories = categoryList(profile);
        const sortMode = profile.sortMode ?? "default";
        const sortModes = ["default", "name", "buyPrice", "sellPrice", "category"];
        const sortLabels = {
            default: "Default",
            name: "Name (A-Z)",
            buyPrice: "Buy Price (Low)",
            sellPrice: "Sell Price (Low)",
            category: "Category (A-Z)",
        };
        const picker = new ActionFormData()
            .title(`Shop Profile: ${profile.id}`)
            .body(`Currency: ${profile.currencyObjective}\nSort: ${sortLabels[sortMode]}\nCategories: ${categories.length}`)
            .button("Set currency objective", ICONS.settings)
            .button("Categories", ICONS.menu)
            .button(`Sort: ${sortLabels[sortMode]}`, ICONS.settings)
            .button("Add item", ICONS.confirm)
            .button("Add kit", ICONS.shop)
            .button("Add held item", ICONS.binding)
            .button("Sell all sellable", ICONS.sellAll)
            .button("Back", ICONS.back);
        const response = await picker.show(player).catch(() => undefined);
        if (!response || response.canceled || response.selection === undefined)
            return;
        if (response.selection === 0) {
            const modal = new ModalFormData()
                .title("Set Currency Objective")
                .textField("Objective", "money", {
                defaultValue: profile.currencyObjective,
            })
                .submitButton("Save");
            const result = await modal.show(player).catch(() => undefined);
            if (!result || result.canceled || !result.formValues)
                continue;
            const objective = String(result.formValues[0] ?? "").trim();
            if (!objective)
                continue;
            profile.currencyObjective = objective;
            saveShops();
            tell(player, `Currency objective updated to "${objective}".`);
            continue;
        }
        if (response.selection === 1) {
            await showCategoryManager(player, profile);
            continue;
        }
        if (response.selection === 2) {
            const sortForm = new ActionFormData()
                .title("Sort Mode")
                .body("Choose how items are sorted in this shop.");
            for (const mode of sortModes) {
                const checked = mode === sortMode ? "§a✓ " : "  ";
                sortForm.button(`${checked}${sortLabels[mode]}`, ICONS.settings);
            }
            sortForm.button("Back", ICONS.back);
            const sortResponse = await sortForm.show(player).catch(() => undefined);
            if (!sortResponse || sortResponse.canceled || sortResponse.selection === undefined)
                continue;
            if (sortResponse.selection < sortModes.length) {
                profile.sortMode = sortModes[sortResponse.selection];
                saveShops();
                tell(player, `Sort mode set to "${sortLabels[profile.sortMode]}".`);
            }
            continue;
        }
        if (response.selection === 3) {
            const modal = new ModalFormData()
                .title("Add Shop Item")
                .textField("Item ID", "minecraft:iron_ingot")
                .textField("Shop label", "Iron Ingot")
                .textField("Item display name (optional)", "Shown on given item")
                .textField("Category (optional)", "Tools")
                .toggle("Can be bought", { defaultValue: true })
                .textField("Buy price", "30", { defaultValue: "30" })
                .toggle("Can be sold", { defaultValue: true })
                .textField("Sell price", "15", { defaultValue: "15" })
                .textField("Quantities (comma-separated)", "1,16,64", { defaultValue: "1,16,64" })
                .textField("Kit items (optional)", "", { defaultValue: "" })
                .submitButton("Add");
            const result = await modal.show(player).catch(() => undefined);
            if (!result || result.canceled || !result.formValues)
                continue;
            const itemId = String(result.formValues[0] ?? "").trim();
            const label = String(result.formValues[1] ?? "").trim();
            const displayName = String(result.formValues[2] ?? "").trim();
            const category = String(result.formValues[3] ?? "").trim();
            const canBuy = Boolean(result.formValues[4]);
            const buyPrice = Math.max(0, Math.floor(Number(result.formValues[5] ?? 0)));
            const canSell = Boolean(result.formValues[6]);
            const sellPrice = Math.max(0, Math.floor(Number(result.formValues[7] ?? 0)));
            const quantities = (String(result.formValues[8] ?? "1"))
                .split(",")
                .map((v) => Math.max(1, Math.floor(Number(v.trim()))))
                .filter((v, i, a) => a.indexOf(v) === i)
                .sort((a, b) => a - b);
            const bundle = splitList(String(result.formValues[9] ?? "")).map(parseItemStackDefinitionLine).filter((entry) => Boolean(entry));
            if (!itemId) {
                tell(player, "Item ID is required.");
                continue;
            }
            const nextItem = {
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
        if (response.selection === 4) {
            await kitBuilderFlow(player, profile);
            continue;
        }
        if (response.selection === 5) {
            await addHeldItemFlow(player, profile);
            continue;
        }
        if (response.selection === 6) {
            await sellAllSellableItems(player, profile.id);
            continue;
        }
        return;
    }
}
