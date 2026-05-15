import { Player, world, ItemStack, EntityComponentTypes, ItemComponentTypes } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { TauUi } from "./tau-ui";
import { ICONS, ICON_DEV_OPTIONS, WORKING_ICON_OPTIONS, isWorkingIconPath, type CrateAnimationPreset, type TauItemConsumptionMode, type TauItemTriggerType, type TauItemAction, type TauItemDefinition, type FormDefinition, type CrateItemReward } from "../types";
import { getInventoryContainer, isFeatureEnabled, isOperator, normalizeKey, saveBinds, saveChat, saveConfig, saveCrates, saveForms, saveGenerators, saveModeration, savePrune, saveTauItems, state, tell } from "../storage";
import { pruneData, tellPruneResult } from "../prune";
import { addGeneratorTier, createGeneratorDefinition, deleteGeneratorDefinition, getGeneratorAutoBreakerCost, getGeneratorDefinition, getGeneratorInfoLines, getGeneratorTierSummary, getNextUpgradeCost, getPlacedGeneratorAtLocation, getPlacedGeneratorDefinition, getPlacedGeneratorInfoLines, giveGenerator, listGeneratorDefinitions, pickupGenerator, removeGeneratorTier, toggleGeneratorAutoBreaker, updateGeneratorConfig, updateGeneratorDefinition, updateGeneratorTier, upgradeGenerator } from "../generators";
import { giveCrateKey, listCrateIds, removeCrateAtBlock, setCrateAtBlock, setCrateAtCoordinates } from "../crates";
import { createTauItemDefinition, deleteTauItemDefinition, getTauItemDefinition, giveTauItem, listTauItemIds, updateTauItemDefinition } from "../tau-items";
import { getHeldItemSnapshot, heldItemToCrateReward, applyHeldItemSnapshotToGenerator, getOnlinePlayerByName } from "./ui-utils";

function normalizeItemId(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

type ModerationItemSnapshot = {
  slot: number;
  itemId: string;
  amount: number;
  nameTag?: string;
  lore?: string[];
};

function isBannedItemId(itemId: string): boolean {
  const normalized = normalizeItemId(itemId);
  return state.moderation.bannedItems.some((entry) => normalizeItemId(entry.itemId) === normalized);
}

function clearBannedHeldItem(player: Player): boolean {
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!container) return false;
  const held = container.getItem(player.selectedSlotIndex);
  if (!held) return false;
  if (!isBannedItemId(held.typeId)) return false;
  container.setItem(player.selectedSlotIndex, undefined);
  return true;
}

function clearBannedInventoryItems(player: Player): number {
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!container) return 0;
  let removed = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (!stack || !isBannedItemId(stack.typeId)) continue;
    removed += stack.amount;
    container.setItem(slot, undefined);
  }
  return removed;
}

function getContainerItems(container: { size: number; getItem(slot: number): ItemStack | undefined }, slotCount?: number): Array<{ slot: number; stack: ItemStack }> {
  const items: Array<{ slot: number; stack: ItemStack }> = [];
  const totalSlots = Math.max(0, Math.floor(Math.min(slotCount ?? container.size ?? 0, container.size ?? 0)));
  for (let slot = 0; slot < totalSlots; slot++) {
    const stack = container.getItem(slot);
    if (!stack) continue;
    items.push({ slot, stack });
  }
  return items;
}

function formatStackLine(slot: number, stack: ItemStack): string {
  const name = stack.nameTag?.trim() || stack.typeId;
  const lore = stack.getLore().map((line) => String(line).trim()).filter((line) => line.length > 0);
  const loreText = lore.length > 0 ? ` | ${lore.slice(0, 2).join(" / ")}` : "";
  return `§7${slot + 1}. §f${name} §8x${stack.amount} §7(${stack.typeId})${loreText}`;
}

function getContainerSnapshot(container: { size: number; getItem(slot: number): ItemStack | undefined; isValid?: boolean }, slotCount?: number): ModerationItemSnapshot[] | undefined {
  try {
    if (container.isValid === false) return undefined;
    const snapshot: ModerationItemSnapshot[] = [];
    const totalSlots = Math.max(0, Math.floor(Math.min(slotCount ?? container.size ?? 0, container.size ?? 0)));
    for (let slot = 0; slot < totalSlots; slot++) {
      const stack = container.getItem(slot);
      if (!stack) continue;
      snapshot.push({
        slot,
        itemId: stack.typeId,
        amount: stack.amount,
        nameTag: stack.nameTag?.trim() || undefined,
        lore: stack.getLore().map((line) => String(line).trim()).filter((line) => line.length > 0),
      });
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function saveModerationInspectionSnapshot(playerName: string, inventory: ModerationItemSnapshot[]): void {
  state.moderation.inspectionSnapshots ??= {};
  state.moderation.inspectionSnapshots[playerName.toLowerCase()] = {
    playerName,
    updatedAt: Date.now(),
    inventory,
  };
  saveModeration();
}

function getInspectionSnapshotKey(playerName: string): string {
  return String(playerName ?? "").trim().toLowerCase();
}

async function showContainerInspector(player: Player, title: string, container: { size: number; getItem(slot: number): ItemStack | undefined; setItem(slot: number, item?: ItemStack): void }, slotCount?: number) {
  while (true) {
    const items = getContainerItems(container, slotCount);
    const res = await TauUi.action(title)
      .body(items.length > 0 ? items.map((entry) => formatStackLine(entry.slot, entry.stack)).join("\n") : "§7No items found.")
      .button("deleteItem", "Delete Item", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (res.canceled || res.id === "back") return;

    if (items.length === 0) continue;

    const picker = TauUi.action(`${title} - Delete Item`)
      .body("§7Select an item to delete.");
    for (let i = 0; i < items.length; i++) {
      picker.button(String(i), formatStackLine(items[i].slot, items[i].stack), { iconPath: ICONS.delete });
    }
    picker.button("back", "Back", { iconPath: ICONS.back });
    const picked = await picker.show(player);
    if (picked.canceled || picked.id === "back") continue;
    if (picked.id === undefined) continue;
    const entry = items[parseInt(picked.id)];
    if (!entry) continue;
    container.setItem(entry.slot, undefined);
    tell(player, `§aDeleted ${entry.stack.typeId} from slot ${entry.slot + 1}.`);
  }
}

async function showOnlinePlayerInspector(player: Player) {
  while (true) {
    const online = world.getAllPlayers().filter((entry) => entry.name !== player.name);
    const targets = online.length > 0 ? online : [player];
    const res = await TauUi.action("§cPlayer Inspector§r")
      .body(`§7Online players: §f${world.getAllPlayers().length}§r`)
      .button("inventory", "Inventory", { iconPath: ICONS.item })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (res.canceled || res.id === "back") return;

    const picker = TauUi.action<{ name: string }>("Select Player")
      .body("§7Choose a player to inspect.");
    for (const target of targets) {
      picker.button(target.name, target.name, { iconPath: ICONS.item, value: { name: target.name } });
    }
    picker.button("back", "Back", { iconPath: ICONS.back });
    const picked = await picker.show(player);
    if (picked.canceled || picked.id === "back") continue;

    const target = targets.find((t) => t.name === picked.value!.name)!;
    const inventoryContainer = getInventoryContainer(target);
    const inventorySnapshot = inventoryContainer ? (getContainerSnapshot(inventoryContainer) ?? []) : [];

    const container = inventoryContainer;
    if (!container) {
      tell(player, "That player has no inventory component.");
      continue;
    }
    saveModerationInspectionSnapshot(target.name, inventorySnapshot);
    await showContainerInspector(player, `Inventory: ${target.name}`, container);
  }
}

async function showOfflinePlayerInspector(player: Player) {
  const result = await TauUi.modal("Offline Player Inspector")
    .text("playerName", "Player name", { placeholder: "Steve" })
    .submitButton("Search")
    .show(player);
  if (result.canceled) return;
  const name = String(result.values.playerName ?? "").trim();
  if (!name) {
    tell(player, "Player name is required.");
    return;
  }

  const online = getOnlinePlayerByName(name);
  if (online) {
    tell(player, "That player is online. Use the online inspector instead.");
    return;
  }

  const snapshot = state.moderation.inspectionSnapshots?.[getInspectionSnapshotKey(name)];
  if (!snapshot) {
    tell(player, `No offline inventory snapshot is stored for ${name}. Online players can still be inspected.`);
    return;
  }

  tell(player, `Saved snapshot for ${snapshot.playerName}: inventory ${snapshot.inventory.length} item(s).`);
}

function captureHeldBannedItem(player: Player): { itemId: string; label?: string } | undefined {
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  const held = container?.getItem(player.selectedSlotIndex);
  if (!held) return undefined;
  return {
    itemId: held.typeId,
    label: held.nameTag?.trim() || undefined,
  };
}

function getCrateRewardChanceText(reward: import("../types").CrateReward, totalWeight: number): string {
  if (totalWeight <= 0) return "0%";
  const chance = (reward.weight / totalWeight) * 100;
  return `${chance.toFixed(chance >= 10 ? 1 : 2)}%`;
}

async function showModerationPlayerCleaner(player: Player) {
  const online = world.getAllPlayers();
  if (online.length === 0) {
    tell(player, "No online players found.");
    return;
  }

  const picker = TauUi.action<{ index: number }>("§cClean Banned Items§r")
    .body("§7Select a player to clean.§r");
  for (let i = 0; i < online.length; i++) {
    picker.button(String(i), online[i].name, { iconPath: ICONS.delete, value: { index: i } });
  }
  picker.button("back", "Back", { iconPath: ICONS.back });
  const picked = await picker.show(player);
  if (picked.canceled || picked.id === "back") return;

  const target = online[picked.value!.index];
  const removed = clearBannedInventoryItems(target);
  tell(player, removed > 0 ? `§aRemoved ${removed} banned items from ${target.name}.§r` : `§7No banned items found in ${target.name}'s inventory.§r`);
}

export async function showIconDevMenu(player: Player) {
  while (true) {
    const form = TauUi.action<{ index: number }>("§6Icon Dev§r")
      .body("§7Preview the allowlisted working icons.§r");

    for (let i = 0; i < ICON_DEV_OPTIONS.length; i++) {
      const option = ICON_DEV_OPTIONS[i];
      form.button(String(i), option.label, { iconPath: option.path, value: { index: i } });
    }
    form.button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled) return;
    if (response.id === "back") return;
    if (response.value === undefined) return;

    const option = ICON_DEV_OPTIONS[response.value.index];

    const preview = await TauUi.action(`§6${option.label}§r`)
      .body(`§7Path: §f${option.path ?? "none"}§r`)
      .button("use", "Use This Icon", { iconPath: option.path })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (preview.canceled || preview.id !== "use") continue;
  }
}

export async function showModerationMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to manage moderation settings.");
    return;
  }

  while (true) {
    const banned = state.moderation.bannedItems;
    const response = await TauUi.action("§cModeration§r")
      .body(`§7Banned items: §f${banned.length}§r`)
      .button("addHeldItem", "Add Held Item", { iconPath: ICONS.item })
      .button("listBanned", "List Banned Items", { iconPath: ICONS.menu })
      .button("cleanPlayer", "Clean Player Inventory", { iconPath: ICONS.delete })
      .button("playerInspector", "Player Inspector", { iconPath: ICONS.utility })
      .button("clearHeld", "Clear Held Item If Banned", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "addHeldItem") {
      const held = captureHeldBannedItem(player);
      if (!held) {
        tell(player, "Hold an item first.");
        continue;
      }
      if (isBannedItemId(held.itemId)) {
        tell(player, "That item is already banned.");
        continue;
      }
      state.moderation.bannedItems.push({
        itemId: held.itemId,
        label: held.label,
        clearHeld: true,
        clearInventory: true,
      });
      saveModeration();
      tell(player, `§aBanned ${held.itemId}.§r`);
      continue;
    }

    if (response.id === "listBanned") {
      if (banned.length === 0) {
        tell(player, "No banned items set.");
        continue;
      }
      const pick = TauUi.action<{ index: number }>("§cBanned Items§r").body("§7Select an item to remove or review.§r");
      for (let i = 0; i < banned.length; i++) {
        const entry = banned[i];
        pick.button(String(i), `§7${entry.itemId}§r${entry.label ? ` - ${entry.label}` : ""}`, { iconPath: ICONS.delete, value: { index: i } });
      }
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const entry = banned[picked.value.index];
      const detailResponse = await TauUi.action("§cBanned Item§r")
        .body(`§7Item: §f${entry.itemId}\n§7Label: §f${entry.label ?? "None"}\n§7Clear held: §f${entry.clearHeld ? "Yes" : "No"}\n§7Clear inventory: §f${entry.clearInventory ? "Yes" : "No"}`)
        .button("remove", "Remove", { iconPath: ICONS.delete })
        .button("back", "Back", { iconPath: ICONS.back })
        .show(player);
      if (detailResponse.canceled || detailResponse.id !== "remove") continue;
      state.moderation.bannedItems.splice(picked.value.index, 1);
      saveModeration();
      tell(player, `§aRemoved ${entry.itemId} from the banned list.§r`);
      continue;
    }

    if (response.id === "cleanPlayer") {
      await showModerationPlayerCleaner(player);
      continue;
    }

    if (response.id === "playerInspector") {
      const pickedMode = await TauUi.action("Player Inspector")
        .body("§7Choose a target source.")
        .button("online", "Online Players", { iconPath: ICONS.item })
        .button("offline", "Offline Player", { iconPath: ICONS.menu })
        .button("back", "Back", { iconPath: ICONS.back })
        .show(player);
      if (pickedMode.canceled || pickedMode.id === "back") continue;
      if (pickedMode.id === "online") {
        await showOnlinePlayerInspector(player);
      } else {
        await showOfflinePlayerInspector(player);
      }
      continue;
    }

    if (response.id === "clearHeld") {
      const removed = clearBannedInventoryItems(player);
      tell(player, removed > 0 ? `§aCleared ${removed} banned item(s) from your inventory.§r` : "§7No banned items found in your inventory.§r");
      continue;
    }
  }
}

export async function showBindingsEditor(player: Player) {
  if (!isFeatureEnabled("bindings")) {
    tell(player, "Bindings are disabled.");
    return;
  }
  while (true) {
    const response = await TauUi.action("Bindings")
      .button("setItemBind", "Set item bind", { iconPath: ICONS.binding })
      .button("setEntityTagBind", "Set entity-tag bind", { iconPath: ICONS.binding })
      .button("setItemLoreBind", "Set item lore bind", { iconPath: ICONS.edit })
      .button("setHeldItemLore", "Set held item lore", { iconPath: ICONS.edit })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "setItemBind") {
      const result = await TauUi.modal("Item Bind")
        .text("itemId", "Item type id", { placeholder: "minecraft:clock" })
        .text("menuId", "Menu id", { placeholder: "main_menu" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const itemId = String(result.values.itemId ?? "").trim();
      const menuId = String(result.values.menuId ?? "").trim();
      if (!itemId || !menuId) continue;
      state.binds.itemBinds[itemId] = menuId;
      state.binds.itemBinds[normalizeKey(itemId)] = menuId;
      saveBinds();
      tell(player, `Bound ${itemId} -> ${menuId}.`);
      continue;
    }

    if (response.id === "setEntityTagBind") {
      const result = await TauUi.modal("Entity Tag Bind")
        .text("tag", "Entity tag", { placeholder: "menuid:main_menu" })
        .text("menuId", "Menu id", { placeholder: "main_menu" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const tag = String(result.values.tag ?? "").trim();
      const menuId = String(result.values.menuId ?? "").trim();
      if (!tag || !menuId) continue;
      state.binds.entityTagBinds[tag] = menuId;
      saveBinds();
      tell(player, `Bound entity tag ${tag} -> ${menuId}.`);
      continue;
    }

    if (response.id === "setItemLoreBind") {
      const result = await TauUi.modal("Lore Item Bind")
        .text("menuId", "Menu id", { placeholder: "main_menu" })
        .text("loreLine", "Lore line to match", { placeholder: "Open Menu" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const menuId = String(result.values.menuId ?? "").trim();
      const loreLine = String(result.values.loreLine ?? "").trim();
      if (!menuId || !loreLine) continue;
      state.binds.itemBinds[`lore:${loreLine}`] = menuId;
      state.binds.itemBinds[`lore:${normalizeKey(loreLine)}`] = menuId;
      saveBinds();
      tell(player, `Bound lore "${loreLine}" -> ${menuId}.`);
      continue;
    }

    if (response.id === "setHeldItemLore") {
      const { ItemStack } = await import("@minecraft/server");
      const selected = player
        .getComponent((await import("@minecraft/server")).EntityComponentTypes.Inventory)
        ?.container?.getItem(player.selectedSlotIndex);
      if (!selected) {
        tell(player, "Hold an item first.");
        continue;
      }
      const result = await TauUi.modal("Set Held Item Lore")
        .text("loreText", "Lore lines (one per line)", { placeholder: "Line 1\nLine 2" })
        .submitButton("Apply")
        .show(player);
      if (result.canceled) continue;
      const loreText = String(result.values.loreText ?? "").trim();
      if (!loreText) continue;
      const lore = loreText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      selected.setLore(lore);
      const { getInventoryContainer } = await import("../storage");
      const inv = getInventoryContainer(player);
      if (inv) inv.setItem(player.selectedSlotIndex, selected);
      tell(player, "Lore applied to held item.");
      continue;
    }

    return;
  }
}

export async function showConfigMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit config.");
    return;
  }

  while (true) {
    const features = state.config.features;
    const response = await TauUi.action("§bTau Config§r")
      .body("Toggle addon features on or off.")
      .button("creator", `Creator: ${features.creator ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("forms", `Forms: ${features.forms ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("shops", `Shops: ${features.shops ? "On" : "Off"}`, { iconPath: ICONS.shop })
      .button("sidebars", `Sidebars: ${features.sidebars ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("bindings", `Bindings: ${features.bindings ? "On" : "Off"}`, { iconPath: ICONS.binding })
      .button("stats", `Stats: ${features.stats ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("plots", `Plots: ${features.plots ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("tpa", `TPA: ${features.tpa ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("homes", `Homes: ${features.homes ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("pay", `Pay: ${features.pay ? "On" : "Off"}`, { iconPath: ICONS.shop })
      .button("playerConfig", `Player Config: ${features.playerConfig ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("teams", `Teams: ${features.teams ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("warps", `Warps: ${features.warps ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("plotTp", `Plot TP: ${features.plotTp ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("generators", `Generators: ${features.generators ? "On" : "Off"}`, { iconPath: ICONS.shop })
      .button("items", `TauItems: ${features.items ? "On" : "Off"}`, { iconPath: ICONS.utility })
      .button("combat", `Combat: ${features.combat ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("moderation", `Moderation: ${features.moderation ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("customAreas", `Custom Areas: ${features.customAreas ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("lootChests", `Loot Chests: ${features.lootChests ? "On" : "Off"}`, { iconPath: ICONS.item })
      .button("prune", "Prune Data", { iconPath: ICONS.delete })
      .button("socialSettings", "Social Settings", { iconPath: ICONS.settings })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "socialSettings") {
      const { showSocialSettingsAdmin } = await import("./social-ui");
      await showSocialSettingsAdmin(player);
      continue;
    }

    if (response.id === "prune") {
      await showPruneDataMenu(player);
      continue;
    }

    if (response.id === "warps") {
      features.warps = !features.warps;
      saveConfig();
      continue;
    }

    if (response.id === "plotTp") {
      features.plotTp = !features.plotTp;
      saveConfig();
      continue;
    }

    if (response.id === "generators") {
      features.generators = !features.generators;
      saveConfig();
      continue;
    }

    if (response.id === "items") {
      features.items = !features.items;
      saveConfig();
      continue;
    }

    if (response.id === "combat") {
      features.combat = !features.combat;
      saveConfig();
      continue;
    }

    if (response.id === "moderation") {
      features.moderation = !features.moderation;
      saveConfig();
      continue;
    }

    if (response.id === "customAreas") {
      features.customAreas = !features.customAreas;
      saveConfig();
      continue;
    }

    const keys: Record<string, keyof typeof features> = {
      creator: "creator", forms: "forms", shops: "shops", sidebars: "sidebars",
      bindings: "bindings", stats: "stats", plots: "plots", tpa: "tpa",
      homes: "homes", pay: "pay", playerConfig: "playerConfig", teams: "teams",
      lootChests: "lootChests",
    };
    const key = keys[response.id];
    if (!key) continue;
    features[key] = !features[key];
    saveConfig();
  }
}

export async function showPruneDataMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit prune settings.");
    return;
  }

  while (true) {
    const prune = state.prune.config;
    const response = await TauUi.action("Prune Data")
      .body(`Enabled: ${prune.enabled ? "On" : "Off"}\nInactive days: ${prune.inactiveDays}\nFlags: stats, profiles, teams, plots, homes, tpa, pay, playerSettings`)
      .button("toggleEnabled", `Enabled: ${prune.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("setInactiveDays", "Set Inactive Days", { iconPath: ICONS.edit })
      .button("stats", `Stats: ${prune.flags.stats ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("profiles", `Profiles: ${prune.flags.profiles ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("teams", `Teams: ${prune.flags.teams ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("plots", `Plots: ${prune.flags.plots ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("homes", `Homes: ${prune.flags.homes ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("tpa", `TPA: ${prune.flags.tpa ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("pay", `Pay: ${prune.flags.pay ? "On" : "Off"}`, { iconPath: ICONS.shop })
      .button("playerSettings", `Player Settings: ${prune.flags.playerSettings ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("dryRun", "Dry Run", { iconPath: ICONS.confirm })
      .button("executePrune", "Execute Prune", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;

    if (response.id === "toggleEnabled") {
      prune.enabled = !prune.enabled;
      savePrune();
      continue;
    }
    if (response.id === "setInactiveDays") {
      const result = await TauUi.modal("Inactive Days")
        .text("days", "Days", { placeholder: "30", defaultValue: String(prune.inactiveDays) })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const days = Math.max(1, Math.floor(Number(result.values.days ?? 30)));
      if (Number.isFinite(days)) prune.inactiveDays = days;
      savePrune();
      continue;
    }

    const flagKeys: Record<string, keyof typeof prune.flags> = {
      stats: "stats", profiles: "profiles", teams: "teams", plots: "plots",
      homes: "homes", tpa: "tpa", pay: "pay", playerSettings: "playerSettings",
    };
    const flagKey = flagKeys[response.id];
    if (flagKey) {
      prune.flags[flagKey] = !prune.flags[flagKey];
      savePrune();
      continue;
    }

    if (response.id === "dryRun") {
      const result = pruneData(true);
      tellPruneResult(player, result, true);
      continue;
    }
    if (response.id === "executePrune") {
      const result = pruneData(false);
      tellPruneResult(player, result, false);
      continue;
    }
    if (response.id === "back") return;
  }
}

export async function showGeneratorMenu(player: Player) {
  while (true) {
    const defs = listGeneratorDefinitions();
    const response = await TauUi.action("§bGenerators§r")
      .body("§7Place generators, sneak-left-click to pick them up.§r")
      .button("myGenerators", "My Generators", { iconPath: ICONS.menu })
      .button("placeGenerator", "Place Held Generator", { iconPath: ICONS.confirm })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;
    if (response.id === "myGenerators") {
      if (defs.length === 0) {
        tell(player, "No generators exist yet.");
        continue;
      }
      const pick = TauUi.action<{ defId: string }>("My Generators").body("Select a generator definition.");
      for (const def of defs) pick.button(def.id, def.name, { iconPath: ICONS.menu, value: { defId: def.id } });
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const info = getGeneratorInfoLines(picked.value.defId);
      tell(player, info.join(" | "));
      continue;
    }
    if (response.id === "placeGenerator") {
      tell(player, "Use a generator item on a block to place it.");
      continue;
    }
  }
}

const TAU_ITEM_TRIGGER_OPTIONS: TauItemTriggerType[] = ["use_air", "use_block", "hit_melee", "mine_block"];
const TAU_ITEM_CONSUMPTION_OPTIONS: TauItemConsumptionMode[] = ["none", "consume_item", "damage_durability"];

function parseTriggerCsv(value: string): TauItemTriggerType[] {
  const values = String(value ?? "").split(",").map((entry) => entry.trim().toLowerCase());
  const selected = TAU_ITEM_TRIGGER_OPTIONS.filter((trigger) => values.includes(trigger));
  return selected.length > 0 ? selected : ["use_air"];
}

function parseActionsJson(raw: string, fallback: TauItemAction[]): TauItemAction[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return parsed as TauItemAction[];
  } catch {
    return fallback;
  }
}

function parseSingleActionJson(raw: string): TauItemAction | undefined {
  try {
    const parsed = JSON.parse(raw) as TauItemAction;
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function parseCommandList(raw: string): string[] {
  return String(raw ?? "")
    .split(/\n|\|/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function serializeCommandList(commands: string[] | undefined): string {
  return (commands ?? []).join("\n");
}

const TAU_ITEM_PARTICLE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Totem", value: "minecraft:totem_particle" },
  { label: "Flame", value: "minecraft:basic_flame_particle" },
  { label: "Smoke", value: "minecraft:basic_smoke_particle" },
  { label: "Portal", value: "minecraft:portal_directional" },
  { label: "End Rod", value: "minecraft:endrod_particle" },
  { label: "Spark", value: "minecraft:villager_happy" },
  { label: "Explode", value: "minecraft:huge_explosion_emitter" },
  { label: "Bubble", value: "minecraft:bubble_particle" },
];

const TAU_ITEM_EFFECT_OPTIONS = ["speed", "strength", "haste", "jump_boost", "regeneration", "fire_resistance", "invisibility"];

async function showTauItemActionSimpleCreate(player: Player): Promise<TauItemAction | undefined> {
  const response = await TauUi.action("Simple Action")
    .body("Choose an action type.")
    .button("command", "Command Chain", { iconPath: ICONS.command })
    .button("sound", "Sound", { iconPath: ICONS.settings })
    .button("particle", "Particle", { iconPath: ICONS.utility })
    .button("effect", "Effect", { iconPath: ICONS.settings })
    .button("projectile", "Projectile", { iconPath: ICONS.binding })
    .button("aoe", "AOE", { iconPath: ICONS.shop })
    .button("back", "Back", { iconPath: ICONS.back })
    .show(player);
  if (response.canceled || response.id === undefined || response.id === "back") return undefined;

  if (response.id === "command") {
    const result = await TauUi.modal("Command Chain")
      .text("cmd1", "Command 1", { placeholder: "say hello" })
      .text("cmd2", "Command 2 (optional)", { placeholder: "" })
      .text("cmd3", "Command 3 (optional)", { placeholder: "" })
      .text("cmd4", "Command 4 (optional)", { placeholder: "" })
      .submitButton("Create")
      .show(player);
    if (result.canceled) return undefined;
    const commands = [String(result.values.cmd1 ?? ""), String(result.values.cmd2 ?? ""), String(result.values.cmd3 ?? ""), String(result.values.cmd4 ?? "")].filter((entry) => entry.trim().length > 0);
    return commands.length > 0 ? { type: "command", commands } : undefined;
  }

  if (response.id === "sound") {
    const result = await TauUi.modal("Sound")
      .text("soundId", "Sound id", { placeholder: "random.levelup" })
      .text("volume", "Volume", { placeholder: "1", defaultValue: "1" })
      .text("pitch", "Pitch", { placeholder: "1", defaultValue: "1" })
      .submitButton("Create")
      .show(player);
    if (result.canceled) return undefined;
    return { type: "sound", soundId: String(result.values.soundId ?? "random.levelup"), volume: Number(result.values.volume ?? 1), pitch: Number(result.values.pitch ?? 1) };
  }

  if (response.id === "particle") {
    const options = TAU_ITEM_PARTICLE_OPTIONS.map((entry) => entry.label);
    const result = await TauUi.modal("Particle")
      .dropdown("particleType", "Particle type", options, 0)
      .text("count", "Count", { placeholder: "8", defaultValue: "8" })
      .text("spread", "Spread", { placeholder: "1.2", defaultValue: "1.2" })
      .submitButton("Create")
      .show(player);
    if (result.canceled) return undefined;
    const index = Math.max(0, Math.min(options.length - 1, Math.floor(Number(result.values.particleType ?? 0))));
    return { type: "particle", particleId: TAU_ITEM_PARTICLE_OPTIONS[index]?.value ?? TAU_ITEM_PARTICLE_OPTIONS[0].value, count: Number(result.values.count ?? 8), spread: Number(result.values.spread ?? 1.2) };
  }

  if (response.id === "effect") {
    const result = await TauUi.modal("Effect")
      .dropdown("effectType", "Effect type", TAU_ITEM_EFFECT_OPTIONS, 0)
      .text("durationTicks", "Duration ticks", { placeholder: "200", defaultValue: "200" })
      .text("amplifier", "Amplifier", { placeholder: "1", defaultValue: "1" })
      .submitButton("Create")
      .show(player);
    if (result.canceled) return undefined;
    const index = Math.max(0, Math.min(TAU_ITEM_EFFECT_OPTIONS.length - 1, Math.floor(Number(result.values.effectType ?? 0))));
    return { type: "effect", effectId: TAU_ITEM_EFFECT_OPTIONS[index] ?? "speed", durationTicks: Number(result.values.durationTicks ?? 200), amplifier: Number(result.values.amplifier ?? 0) };
  }

  if (response.id === "projectile") {
    const result = await TauUi.modal("Projectile")
      .text("entityId", "Entity id", { placeholder: "minecraft:snowball" })
      .text("speed", "Speed", { placeholder: "1.6", defaultValue: "1.6" })
      .submitButton("Create")
      .show(player);
    if (result.canceled) return undefined;
    return { type: "projectile", entityId: String(result.values.entityId ?? "minecraft:snowball"), speed: Number(result.values.speed ?? 1.6) };
  }

  if (response.id === "aoe") {
    const result = await TauUi.modal("AOE")
      .text("radius", "Radius", { placeholder: "5", defaultValue: "5" })
      .dropdown("mode", "Mode", ["damage", "heal", "knockback"], 0)
      .text("amount", "Amount", { placeholder: "4", defaultValue: "4" })
      .submitButton("Create")
      .show(player);
    if (result.canceled) return undefined;
    const modeIndex = Math.max(0, Math.min(2, Math.floor(Number(result.values.mode ?? 0))));
    return { type: "aoe", radius: Number(result.values.radius ?? 5), mode: ["damage", "heal", "knockback"][modeIndex] as any, amount: Number(result.values.amount ?? 4) };
  }

  return undefined;
}

async function showTauItemActionCustomCreate(player: Player): Promise<TauItemAction | undefined> {
  const result = await TauUi.modal("Custom Action JSON")
    .text("actionJson", "Action JSON", { placeholder: "{}", defaultValue: '{"type":"sound","soundId":"random.levelup","volume":1,"pitch":1}' })
    .submitButton("Create")
    .show(player);
  if (result.canceled) return undefined;
  return parseSingleActionJson(String(result.values.actionJson ?? "{}"));
}

function parseJsonText<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(String(raw ?? "")) as T;
  } catch {
    return fallback;
  }
}

function defaultTauItemDefinition(id: string, displayName: string, baseItemId: string): TauItemDefinition {
  return {
    id: id.trim().toLowerCase(),
    displayName: displayName.trim() || id.trim(),
    baseItemId: baseItemId.trim() || "minecraft:stick",
    loreDescription: "Custom Tau item",
    triggers: ["use_air"],
    actions: [{ type: "sound", soundId: "random.levelup", volume: 0.6, pitch: 1 }, { type: "command", commands: ["say {player} used a TauItem"] }],
    cooldownSeconds: 5,
    consumption: "none",
    maxUses: undefined,
    cancelVanilla: true,
  };
}

async function showTauItemActionsMenu(player: Player, tauItemId: string) {
  while (true) {
    const def = getTauItemDefinition(tauItemId);
    if (!def) {
      tell(player, "TauItem not found.");
      return;
    }

    const response = await TauUi.action(`Actions: ${def.displayName}`)
      .body(`§7Actions: §f${def.actions.length}`)
      .button("simpleAdd", "Simple Add", { iconPath: ICONS.confirm })
      .button("customAdd", "Custom Add", { iconPath: ICONS.command })
      .button("editAction", "Edit Action", { iconPath: ICONS.edit })
      .button("deleteAction", "Delete Action", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "simpleAdd" || response.id === "customAdd") {
      const action = response.id === "simpleAdd" ? await showTauItemActionSimpleCreate(player) : await showTauItemActionCustomCreate(player);
      if (!action) continue;
      def.actions.push(action);
      saveTauItems();
      continue;
    }

    if (response.id === "editAction" || response.id === "deleteAction") {
      if (def.actions.length === 0) continue;
      const isDelete = response.id === "deleteAction";
      const picker = TauUi.action<{ index: number }>(isDelete ? "Delete Action" : "Edit Action").body("Select an action.");
      def.actions.forEach((action, index) => picker.button(String(index), `${index + 1}. ${action.type}`, { iconPath: isDelete ? ICONS.delete : ICONS.edit, value: { index } }));
      picker.button("back", "Back", { iconPath: ICONS.back });
      const picked = await picker.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      if (isDelete) {
        def.actions.splice(picked.value.index, 1);
        saveTauItems();
        continue;
      }

      const action = def.actions[picked.value.index];
      if (action.type === "command") {
        const result = await TauUi.modal("Edit Command Chain")
          .text("commands", "Commands (one per line)", { placeholder: "say hello", defaultValue: serializeCommandList(action.commands) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        action.commands = parseCommandList(String(result.values.commands ?? ""));
        saveTauItems();
        continue;
      }

      if (action.type === "sound") {
        const result = await TauUi.modal("Edit Sound")
          .text("soundId", "Sound id", { placeholder: "random.levelup", defaultValue: action.soundId })
          .text("volume", "Volume", { placeholder: "1", defaultValue: String(action.volume ?? 1) })
          .text("pitch", "Pitch", { placeholder: "1", defaultValue: String(action.pitch ?? 1) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        action.soundId = String(result.values.soundId ?? action.soundId);
        action.volume = Number(result.values.volume ?? action.volume ?? 1);
        action.pitch = Number(result.values.pitch ?? action.pitch ?? 1);
        saveTauItems();
        continue;
      }

      if (action.type === "particle") {
        const particleLabels = TAU_ITEM_PARTICLE_OPTIONS.map((entry) => entry.label);
        const defaultParticleIndex = Math.max(0, TAU_ITEM_PARTICLE_OPTIONS.findIndex((entry) => entry.value === action.particleId));
        const result = await TauUi.modal("Edit Particle")
          .dropdown("particleType", "Particle type", particleLabels, defaultParticleIndex)
          .text("count", "Count", { placeholder: "8", defaultValue: String(action.count ?? 8) })
          .text("spread", "Spread", { placeholder: "1.2", defaultValue: String(action.spread ?? 1.2) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        const particleIndex = Math.max(0, Math.min(TAU_ITEM_PARTICLE_OPTIONS.length - 1, Math.floor(Number(result.values.particleType ?? 0))));
        action.particleId = TAU_ITEM_PARTICLE_OPTIONS[particleIndex]?.value ?? action.particleId;
        action.count = Number(result.values.count ?? action.count ?? 8);
        action.spread = Number(result.values.spread ?? action.spread ?? 1.2);
        saveTauItems();
        continue;
      }

      if (action.type === "effect") {
        const result = await TauUi.modal("Edit Effect")
          .text("effectId", "Effect id", { placeholder: "speed", defaultValue: action.effectId })
          .text("durationTicks", "Duration ticks", { placeholder: "200", defaultValue: String(action.durationTicks) })
          .text("amplifier", "Amplifier", { placeholder: "1", defaultValue: String(action.amplifier ?? 0) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        action.effectId = String(result.values.effectId ?? action.effectId);
        action.durationTicks = Number(result.values.durationTicks ?? action.durationTicks);
        action.amplifier = Number(result.values.amplifier ?? action.amplifier ?? 0);
        saveTauItems();
        continue;
      }

      if (action.type === "projectile") {
        const result = await TauUi.modal("Edit Projectile")
          .text("entityId", "Entity id", { placeholder: "minecraft:snowball", defaultValue: action.entityId })
          .text("speed", "Speed", { placeholder: "1.6", defaultValue: String(action.speed ?? 1.6) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        action.entityId = String(result.values.entityId ?? action.entityId);
        action.speed = Number(result.values.speed ?? action.speed ?? 1.6);
        saveTauItems();
        continue;
      }

      if (action.type === "aoe") {
        const aoeModeIndex = ["damage", "heal", "knockback"].indexOf(action.mode);
        const result = await TauUi.modal("Edit AOE")
          .text("radius", "Radius", { placeholder: "5", defaultValue: String(action.radius) })
          .dropdown("mode", "Mode", ["damage", "heal", "knockback"], aoeModeIndex >= 0 ? aoeModeIndex : 0)
          .text("amount", "Amount", { placeholder: "4", defaultValue: String(action.amount) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        action.radius = Number(result.values.radius ?? action.radius);
        action.mode = ["damage", "heal", "knockback"][Math.max(0, Math.min(2, Math.floor(Number(result.values.mode ?? 0))))] as any;
        action.amount = Number(result.values.amount ?? action.amount);
        saveTauItems();
        continue;
      }
    }
  }
}

async function showTauItemTriggerPicker(player: Player, currentTriggers: TauItemTriggerType[]): Promise<TauItemTriggerType[] | undefined> {
  const result = await TauUi.modal("Set Triggers")
    .toggle("use_air", "On use (air)", currentTriggers.includes("use_air"))
    .toggle("use_block", "On use (block)", currentTriggers.includes("use_block"))
    .toggle("hit_melee", "On hit (melee)", currentTriggers.includes("hit_melee"))
    .toggle("mine_block", "On mine (block)", currentTriggers.includes("mine_block"))
    .submitButton("Save")
    .show(player);
  if (result.canceled) return undefined;

  const selected: TauItemTriggerType[] = [];
  if (Boolean(result.values.use_air)) selected.push("use_air");
  if (Boolean(result.values.use_block)) selected.push("use_block");
  if (Boolean(result.values.hit_melee)) selected.push("hit_melee");
  if (Boolean(result.values.mine_block)) selected.push("mine_block");
  return selected.length > 0 ? selected : ["use_air"];
}

async function showTauItemTriggerEditor(player: Player, tauItemId: string) {
  while (true) {
    const def = getTauItemDefinition(tauItemId);
    if (!def) {
      tell(player, "TauItem not found.");
      return;
    }

    const response = await TauUi.action(`Triggers: ${def.displayName}`)
      .body(`§7Current: §f${def.triggers.join(", ")}`)
      .button("simplePicker", "Simple Picker", { iconPath: ICONS.confirm })
      .button("textCsv", "Text / CSV", { iconPath: ICONS.command })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "simplePicker") {
      const triggers = await showTauItemTriggerPicker(player, def.triggers);
      if (!triggers) continue;
      const res = updateTauItemDefinition(def.id, { triggers });
      tell(player, res.ok ? `§a${res.message}` : `§c${res.message}`);
      continue;
    }

    if (response.id === "textCsv") {
      const result = await TauUi.modal("Set Triggers (Text)")
        .text("triggers", "CSV triggers", { placeholder: "use_air,use_block", defaultValue: def.triggers.join(",") })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const triggers = parseTriggerCsv(String(result.values.triggers ?? ""));
      const res = updateTauItemDefinition(def.id, { triggers });
      tell(player, res.ok ? `§a${res.message}` : `§c${res.message}`);
      continue;
    }
  }
}

async function showTauItemCreateSimple(player: Player) {
  const result = await TauUi.modal("Create TauItem")
    .text("id", "Id", { placeholder: "fire_staff" })
    .text("displayName", "Display name", { placeholder: "§cStaff of Embers" })
    .text("baseItemId", "Base item id", { placeholder: "minecraft:stick" })
    .text("loreDescription", "Lore description", { placeholder: "Custom Tau item" })
    .text("cooldownSeconds", "Cooldown seconds", { placeholder: "5", defaultValue: "5" })
    .text("maxUses", "Max uses (0 = none)", { placeholder: "10", defaultValue: "0" })
    .dropdown("consumption", "Consumption", TAU_ITEM_CONSUMPTION_OPTIONS, 0)
    .toggle("cancelVanilla", "Cancel vanilla behavior", true)
    .submitButton("Create")
    .show(player);
  if (result.canceled) return;

  const id = String(result.values.id ?? "").trim().toLowerCase();
  const displayName = String(result.values.displayName ?? "");
  const baseItemId = String(result.values.baseItemId ?? "minecraft:stick");
  const loreDescription = String(result.values.loreDescription ?? "");
  const cooldownSeconds = Math.max(0, Number(result.values.cooldownSeconds ?? 5));
  const maxUses = Math.max(0, Math.floor(Number(result.values.maxUses ?? 0)));
  const consumptionIndex = Math.max(0, Math.min(TAU_ITEM_CONSUMPTION_OPTIONS.length - 1, Math.floor(Number(result.values.consumption ?? 0))));
  const cancelVanilla = Boolean(result.values.cancelVanilla);

  const triggers = await showTauItemTriggerPicker(player, ["use_air"]);
  if (!triggers) return;

  const create = createTauItemDefinition(id, displayName, baseItemId);
  if (!create.ok) {
    tell(player, `§c${create.message}`);
    return;
  }

  const update = updateTauItemDefinition(id, {
    displayName,
    baseItemId,
    loreDescription,
    triggers,
    cooldownSeconds,
    maxUses: maxUses > 0 ? maxUses : undefined,
    consumption: TAU_ITEM_CONSUMPTION_OPTIONS[consumptionIndex],
    cancelVanilla,
  });
  tell(player, update.ok ? `§a${update.message}` : `§c${update.message}`);
}

async function showTauItemCreateAdvanced(player: Player) {
  const result = await TauUi.modal("Create TauItem (Advanced)")
    .text("tauItemJson", "TauItem JSON", {
      placeholder: "{}",
      defaultValue: JSON.stringify(defaultTauItemDefinition("fire_staff", "§cStaff of Embers", "minecraft:stick"), null, 2),
    })
    .submitButton("Create")
    .show(player);
  if (result.canceled) return;

  const parsed = parseJsonText<TauItemDefinition>(String(result.values.tauItemJson ?? "{}"), defaultTauItemDefinition("fire_staff", "§cStaff of Embers", "minecraft:stick"));
  const id = String(parsed.id ?? "").trim().toLowerCase();
  if (!id) {
    tell(player, "§cTauItem id is required.");
    return;
  }

  const create = createTauItemDefinition(id, parsed.displayName ?? id, parsed.baseItemId ?? "minecraft:stick");
  if (!create.ok) {
    tell(player, `§c${create.message}`);
    return;
  }

  const update = updateTauItemDefinition(id, {
    displayName: parsed.displayName,
    baseItemId: parsed.baseItemId,
    loreDescription: parsed.loreDescription,
    triggers: Array.isArray(parsed.triggers) && parsed.triggers.length > 0 ? parsed.triggers : ["use_air"],
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    cooldownSeconds: Number(parsed.cooldownSeconds ?? 0),
    consumption: parsed.consumption ?? "none",
    requiredTag: parsed.requiredTag,
    cost: parsed.cost,
    cancelVanilla: parsed.cancelVanilla,
  });
  tell(player, update.ok ? `§a${update.message}` : `§c${update.message}`);
}

function parseEnchantmentsText(raw: string): { id: string; level: number }[] {
  const entries = String(raw ?? "")
    .split(/[\n,;]/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const enchantments: { id: string; level: number }[] = [];
  for (const entry of entries) {
    const [idRaw, levelRaw] = entry.split("=", 2);
    const id = String(idRaw ?? "").trim();
    const level = Math.max(1, Math.floor(Number(String(levelRaw ?? "1").trim())));
    if (!id) continue;
    enchantments.push({ id, level });
  }
  return enchantments;
}

async function showTauItemEditor(player: Player, tauItemId: string) {
  while (true) {
    const def = getTauItemDefinition(tauItemId);
    if (!def) {
      tell(player, "TauItem not found.");
      return;
    }

    const response = await TauUi.action(`§6TauItem: ${def.displayName}§r`)
      .body(`§7ID: §f${def.id}\n§7Base item: §f${def.baseItemId}\n§7Triggers: §f${def.triggers.join(", ")}\n§7Cooldown: §f${def.cooldownSeconds}s\n§7Max uses: §f${def.maxUses ?? "none"}\n§7Consumption: §f${def.consumption}\n§7Required tag: §f${def.requiredTag ?? "none"}\n§7Actions: §f${def.actions.length}`)
      .button("editCore", "Edit Core", { iconPath: ICONS.edit })
      .button("setTriggers", "Set Triggers", { iconPath: ICONS.settings })
      .button("manageActions", "Manage Actions", { iconPath: ICONS.edit })
      .button("giveItem", "Give Item", { iconPath: ICONS.confirm })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "editCore") {
      const result = await TauUi.modal(`Edit ${def.id}`)
        .text("displayName", "Display name", { placeholder: "§cStaff of Embers", defaultValue: def.displayName })
        .text("baseItemId", "Base item id", { placeholder: "minecraft:stick", defaultValue: def.baseItemId })
        .text("loreDescription", "Lore description", { placeholder: "Custom Tau item", defaultValue: def.loreDescription ?? "" })
        .text("cooldownSeconds", "Cooldown seconds", { placeholder: "5", defaultValue: String(def.cooldownSeconds) })
        .text("maxUses", "Max uses (0 = none)", { placeholder: "10", defaultValue: String(def.maxUses ?? 0) })
        .dropdown("consumption", "Consumption", TAU_ITEM_CONSUMPTION_OPTIONS, Math.max(0, TAU_ITEM_CONSUMPTION_OPTIONS.indexOf(def.consumption)))
        .text("requiredTag", "Required player tag (optional)", { placeholder: "class:mage", defaultValue: def.requiredTag ?? "" })
        .toggle("cancelVanilla", "Cancel vanilla behavior", def.cancelVanilla !== false)
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const maxUses = Math.max(0, Math.floor(Number(result.values.maxUses ?? 0)));
      const consumptionIndex = Math.max(0, Math.min(TAU_ITEM_CONSUMPTION_OPTIONS.length - 1, Math.floor(Number(result.values.consumption ?? 0))));
      const res = updateTauItemDefinition(def.id, {
        displayName: String(result.values.displayName ?? def.displayName),
        baseItemId: String(result.values.baseItemId ?? def.baseItemId),
        loreDescription: String(result.values.loreDescription ?? def.loreDescription ?? ""),
        cooldownSeconds: Math.max(0, Number(result.values.cooldownSeconds ?? def.cooldownSeconds)),
        maxUses: maxUses > 0 ? maxUses : undefined,
        consumption: TAU_ITEM_CONSUMPTION_OPTIONS[consumptionIndex],
        requiredTag: String(result.values.requiredTag ?? "").trim() || undefined,
        cancelVanilla: Boolean(result.values.cancelVanilla),
      });
      tell(player, res.ok ? res.message : `§c${res.message}`);
      continue;
    }

    if (response.id === "setTriggers") {
      const result = await TauUi.modal("Set Triggers")
        .text("triggers", "CSV triggers", { placeholder: "use_air,use_block", defaultValue: def.triggers.join(",") })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const triggers = parseTriggerCsv(String(result.values.triggers ?? ""));
      tell(player, updateTauItemDefinition(def.id, { triggers }).message);
      continue;
    }

    if (response.id === "manageActions") {
      await showTauItemActionsMenu(player, def.id);
      continue;
    }

    if (response.id === "giveItem") {
      const result = giveTauItem(player, def.id, 1);
      tell(player, result.ok ? result.message : `§c${result.message}`);
      continue;
    }
  }
}

export async function showTauItemsAdminMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to manage TauItems.");
    return;
  }

  while (true) {
    const ids = listTauItemIds();
    const response = await TauUi.action("§6TauItems Admin§r")
      .body(`§7Custom item engine configuration.\n§7Enabled: §f${state.tauItems.config.enabled ? "On" : "Off"}§7 | Items: §f${ids.length}`)
      .button("create", "Create TauItem", { iconPath: ICONS.confirm })
      .button("advancedCreate", "Advanced Create", { iconPath: ICONS.command })
      .button("edit", "Edit TauItem", { iconPath: ICONS.edit })
      .button("delete", "Delete TauItem", { iconPath: ICONS.delete })
      .button("toggleEnabled", `TauItems Enabled: ${state.tauItems.config.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "create") {
      await showTauItemCreateSimple(player);
      continue;
    }

    if (response.id === "advancedCreate") {
      await showTauItemCreateAdvanced(player);
      continue;
    }

    if (response.id === "edit") {
      if (ids.length === 0) {
        tell(player, "No TauItems available.");
        continue;
      }
      const pick = TauUi.action<{ id: string }>("Edit TauItem").body("Select an item.");
      for (const id of ids) pick.button(id, state.tauItems.items[id]?.displayName ?? id, { iconPath: ICONS.edit, value: { id } });
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      await showTauItemEditor(player, picked.value.id);
      continue;
    }

    if (response.id === "delete") {
      if (ids.length === 0) {
        tell(player, "No TauItems available.");
        continue;
      }
      const pick = TauUi.action<{ id: string }>("Delete TauItem").body("Select an item to delete.");
      for (const id of ids) pick.button(id, state.tauItems.items[id]?.displayName ?? id, { iconPath: ICONS.delete, value: { id } });
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const res = deleteTauItemDefinition(picked.value.id);
      tell(player, res.ok ? res.message : `§c${res.message}`);
      continue;
    }

    if (response.id === "toggleEnabled") {
      state.tauItems.config.enabled = !state.tauItems.config.enabled;
      saveTauItems();
      continue;
    }
  }
}

export async function showGeneratorAdminMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to manage generators.");
    return;
  }
  while (true) {
    const defs = listGeneratorDefinitions();
    const response = await TauUi.action("§6Generator Admin§r")
      .body(`§7Create and manage generator definitions.\n§7Enabled: §f${state.generators.config.enabled ? "On" : "Off"}§7 | Place anywhere: §f${state.generators.config.defaultPlaceAnywhere ? "On" : "Off"}§7 | Plot-only: §f${state.generators.config.blockOnPlotOnly ? "On" : "Off"}`)
      .button("create", "Create Definition", { iconPath: ICONS.confirm })
      .button("give", "Give Generator", { iconPath: ICONS.binding })
      .button("edit", "Edit Definition", { iconPath: ICONS.edit })
      .button("manageTiers", "Manage Tiers", { iconPath: ICONS.edit })
      .button("manageAutobreakers", "Manage Autobreakers", { iconPath: ICONS.settings })
      .button("settings", "Generator Settings", { iconPath: ICONS.settings })
      .button("delete", "Delete Definition", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;
    if (response.id === "create") {
      const result = await TauUi.modal("Create Generator")
        .text("name", "Name", { placeholder: "Diamond Generator" })
        .text("baseItemId", "Base item id", { placeholder: "minecraft:bedrock" })
        .text("outputItemId", "Output item id", { placeholder: "minecraft:diamond" })
        .text("rateTicks", "Rate ticks", { placeholder: "200" })
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      const create = createGeneratorDefinition(String(result.values.name ?? ""), String(result.values.baseItemId ?? ""), String(result.values.outputItemId ?? ""), Number(result.values.rateTicks ?? 200));
      if (create.ok) {
        const held = getHeldItemSnapshot(player);
        const def = getGeneratorDefinition(String(result.values.name ?? "").trim().toLowerCase());
        if (def && held) {
          applyHeldItemSnapshotToGenerator(def, held);
          saveGenerators();
        }
      }
      tell(player, create.message);
      continue;
    }
    if (response.id === "give") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = TauUi.action<{ defId: string }>("Give Generator").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.id, def.name, { iconPath: ICONS.menu, value: { defId: def.id } });
      targetPick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await targetPick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      tell(player, giveGenerator(player, picked.value.defId).message);
      continue;
    }
    if (response.id === "edit") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = TauUi.action<{ defId: string }>("Edit Generator").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.id, def.name, { iconPath: ICONS.edit, value: { defId: def.id } });
      targetPick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await targetPick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const def = getGeneratorDefinition(picked.value.defId)!;
      const result = await TauUi.modal(`Edit Generator: ${def.name}`)
        .text("name", "Name", { placeholder: "Diamond Generator", defaultValue: def.name })
        .text("baseItemId", "Base item id", { placeholder: "minecraft:bedrock", defaultValue: def.baseItemId })
        .text("outputItemId", "Output item id", { placeholder: "minecraft:diamond", defaultValue: def.outputItemId })
        .text("displayName", "Display name", { placeholder: "Diamond Generator", defaultValue: def.displayName ?? def.name })
        .text("lore", "Lore (one line per line)", { placeholder: "Line 1|Line 2", defaultValue: (def.lore ?? []).join("|") })
        .text("enchantments", "Enchantments (id=level)", { placeholder: "sharpness=1", defaultValue: (def.enchantments ?? []).map((entry) => `${entry.id}=${entry.level}`).join(",") })
        .text("customData", "Custom data JSON", { placeholder: "{}", defaultValue: def.customData ?? "{}" })
        .text("canPlaceOn", "Can place on", { placeholder: "minecraft:stone", defaultValue: (def.canPlaceOn ?? []).join(",") })
        .text("canDestroy", "Can destroy", { placeholder: "minecraft:glass", defaultValue: (def.canDestroy ?? []).join(",") })
        .text("autoBreakerCost", "Autobreaker price (blank = default)", { placeholder: String(getGeneratorAutoBreakerCost(def)), defaultValue: def.autoBreakerCost !== undefined ? String(def.autoBreakerCost) : "" })
        .text("durability", "Durability damage", { placeholder: "0", defaultValue: String(def.durability ?? 0) })
        .text("maxDurability", "Max durability", { placeholder: "0", defaultValue: String(def.maxDurability ?? 0) })
        .toggle("placeAnywhere", "Place anywhere", def.placeAnywhere)
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      tell(player, updateGeneratorDefinition(def.id, {
        name: String(result.values.name ?? def.name),
        baseItemId: String(result.values.baseItemId ?? def.baseItemId),
        outputItemId: String(result.values.outputItemId ?? def.outputItemId),
        displayName: String(result.values.displayName ?? def.displayName ?? def.name),
        lore: String(result.values.lore ?? "").split("|").map((line) => line.trim()).filter((line) => line.length > 0),
        enchantments: parseEnchantmentsText(String(result.values.enchantments ?? "")),
        customData: String(result.values.customData ?? "{}").trim() || undefined,
        canPlaceOn: String(result.values.canPlaceOn ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0),
        canDestroy: String(result.values.canDestroy ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0),
        autoBreakerCost: String(result.values.autoBreakerCost ?? "").trim().length > 0 ? Number(result.values.autoBreakerCost) : undefined,
        durability: Number(result.values.durability ?? 0),
        maxDurability: Number(result.values.maxDurability ?? 0),
        placeAnywhere: Boolean(result.values.placeAnywhere),
      }).message);
      continue;
    }
    if (response.id === "manageTiers") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = TauUi.action<{ defId: string }>("Manage Tiers").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.id, def.name, { iconPath: ICONS.edit, value: { defId: def.id } });
      targetPick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await targetPick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      await showGeneratorTierManager(player, picked.value.defId);
      continue;
    }
    if (response.id === "manageAutobreakers") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = TauUi.action<{ defId: string }>("Manage Autobreakers").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.id, def.name, { iconPath: ICONS.settings, value: { defId: def.id } });
      targetPick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await targetPick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const def = getGeneratorDefinition(picked.value.defId)!;
      const maxTier = def.tiers.reduce((highest, tier) => Math.max(highest, tier.tier), 1);
      const placements = Object.values(state.generators.placed).filter((placed) => placed.definitionId === def.id && placed.tier >= maxTier);
      if (placements.length === 0) {
        tell(player, "No max-tier generators of that definition are placed.");
        continue;
      }
      const placePick = TauUi.action<{ index: number }>(`Autobreakers: ${def.name}`).body("Select a placed generator to toggle.");
      for (let i = 0; i < placements.length; i++) {
        const placed = placements[i];
        const status = placed.autoBreakerPurchased ? (placed.autoBreakerEnabled ? "On" : "Off") : "Locked";
        placePick.button(String(i), `${placed.dimensionId} @ ${placed.x}, ${placed.y}, ${placed.z} | ${status}`, { iconPath: ICONS.settings, value: { index: i } });
      }
      placePick.button("back", "Back", { iconPath: ICONS.back });
      const placedPick = await placePick.show(player);
      if (placedPick.canceled || placedPick.id === "back") continue;
      if (placedPick.value === undefined) continue;
      const placed = placements[placedPick.value.index];
      const toggle = toggleGeneratorAutoBreaker(player, { x: placed.x, y: placed.y, z: placed.z }, placed.dimensionId);
      tell(player, toggle.ok ? `§a[Generators] ${toggle.message}` : `§c[Generators] ${toggle.message}`);
      continue;
    }
    if (response.id === "settings") {
      await showGeneratorSettingsMenu(player);
      continue;
    }
    if (response.id === "delete") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = TauUi.action<{ defId: string }>("Delete Generator").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.id, def.name, { iconPath: ICONS.delete, value: { defId: def.id } });
      targetPick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await targetPick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      tell(player, deleteGeneratorDefinition(picked.value.defId).message);
      continue;
    }
  }
}

async function showGeneratorTierManager(player: Player, defId: string) {
  while (true) {
    const def = getGeneratorDefinition(defId);
    if (!def) {
      tell(player, "Generator not found.");
      return;
    }

    const tiers = def.tiers.slice().sort((a, b) => a.tier - b.tier);
    const response = await TauUi.action(`Tiers: ${def.name}`)
      .body(getGeneratorInfoLines(def.id).join("\n"))
      .button("addTier", "Add Tier", { iconPath: ICONS.confirm })
      .button("editTier", "Edit Tier", { iconPath: ICONS.edit })
      .button("removeTier", "Remove Tier", { iconPath: ICONS.delete })
      .button("setAutoBreakerPrice", "Set Autobreaker Price", { iconPath: ICONS.settings })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "addTier") {
      const result = await TauUi.modal(`Add Tier: ${def.name}`)
        .text("rateTicks", "Rate ticks", { placeholder: "0" })
        .text("upgradeCost", "Upgrade cost", { placeholder: "1000" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      tell(player, addGeneratorTier(def.id, Number(result.values.rateTicks ?? 200), Number(result.values.upgradeCost ?? 1000)).message);
      continue;
    }

    if (response.id === "editTier") {
      if (tiers.length === 0) continue;
      const pick = TauUi.action<{ tierIndex: number }>(`Edit Tier: ${def.name}`).body("Select a tier to edit.");
      for (let i = 0; i < tiers.length; i++) {
        pick.button(String(i), getGeneratorTierSummary(def.id, tiers[i].tier) ?? `Tier ${tiers[i].tier}`, { iconPath: ICONS.edit, value: { tierIndex: i } });
      }
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const tier = tiers[picked.value.tierIndex];
      const editResult = await TauUi.modal(`Edit Tier ${tier.tier}: ${def.name}`)
        .text("rateTicks", "Rate ticks", { placeholder: "0", defaultValue: String(tier.rateTicks) })
        .text("upgradeCost", "Upgrade cost", { placeholder: "1000", defaultValue: String(tier.upgradeCost) })
        .submitButton("Save")
        .show(player);
      if (editResult.canceled) continue;
      tell(player, updateGeneratorTier(def.id, tier.tier, {
        rateTicks: Number(editResult.values.rateTicks ?? tier.rateTicks),
        upgradeCost: Number(editResult.values.upgradeCost ?? tier.upgradeCost),
      }).message);
      continue;
    }

    if (response.id === "removeTier") {
      if (tiers.length === 0) continue;
      const pick = TauUi.action<{ tierIndex: number }>(`Remove Tier: ${def.name}`).body("Select a tier to remove.");
      for (let i = 0; i < tiers.length; i++) {
        pick.button(String(i), getGeneratorTierSummary(def.id, tiers[i].tier) ?? `Tier ${tiers[i].tier}`, { iconPath: ICONS.delete, value: { tierIndex: i } });
      }
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const tier = tiers[picked.value.tierIndex];
      tell(player, removeGeneratorTier(def.id, tier.tier).message);
      continue;
    }

    if (response.id === "setAutoBreakerPrice") {
      const result = await TauUi.modal(`Autobreaker Price: ${def.name}`)
        .text("autoBreakerCost", "Custom autobreaker price (blank = default)", { placeholder: String(getGeneratorAutoBreakerCost(def)), defaultValue: def.autoBreakerCost !== undefined ? String(def.autoBreakerCost) : "" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const raw = String(result.values.autoBreakerCost ?? "").trim();
      tell(player, updateGeneratorDefinition(def.id, { autoBreakerCost: raw.length > 0 ? Number(raw) : undefined }).message);
      continue;
    }
  }
}

export async function showGeneratorSettingsMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit generator settings.");
    return;
  }

  while (true) {
    const config = state.generators.config;
    const response = await TauUi.action("§bGenerator Settings§r")
      .body(`§7Global generator behavior.§r\n§7Autobreakers: §f${config.autoBreakersEnabled ? "On" : "Off"}`)
      .button("toggleEnabled", `Generators: ${config.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("togglePlaceAnywhere", `Default place anywhere: ${config.defaultPlaceAnywhere ? "On" : "Off"}`, { iconPath: ICONS.shop })
      .button("togglePlotOnly", `Block on plots only: ${config.blockOnPlotOnly ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("toggleAutobreakers", `Autobreakers: ${config.autoBreakersEnabled ? "On" : "Off"}`, { iconPath: ICONS.confirm })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "toggleEnabled") {
      updateGeneratorConfig({ enabled: !config.enabled });
      continue;
    }

    if (response.id === "togglePlaceAnywhere") {
      updateGeneratorConfig({ defaultPlaceAnywhere: !config.defaultPlaceAnywhere });
      continue;
    }

    if (response.id === "togglePlotOnly") {
      updateGeneratorConfig({ blockOnPlotOnly: !config.blockOnPlotOnly });
      continue;
    }

    if (response.id === "toggleAutobreakers") {
      updateGeneratorConfig({ autoBreakersEnabled: !config.autoBreakersEnabled });
      continue;
    }
  }
}

function formatCrateLocation(entry: { dimensionId: string; x: number; y: number; z: number }): string {
  return `${entry.dimensionId} @ ${entry.x}, ${entry.y}, ${entry.z}`;
}

async function showCrateEditor(player: Player, crateId: string) {
  while (true) {
    const crate = state.crates.crates[crateId];
    if (!crate) {
      tell(player, "Crate not found.");
      return;
    }

    const locations = Object.values(state.crates.locations).filter((entry) => entry.crateId === crate.id);
    const response = await TauUi.action(`§6Crate: ${crate.displayName}§r`)
      .body(`§7Block: §f${crate.crateBlockId}\n§7Key item: §f${crate.keyItemId}\n§7Key lore: §f${crate.keyLoreLine}\n§7Anim preset: §f${crate.animationPreset}\n§7Particle preset: §f${crate.particlePreset}\n§7Broadcast rare wins: §f${crate.broadcastRareWins ? "On" : "Off"}\n§7Rare threshold: §f${crate.rareBroadcastWeightThreshold}\n§7Rewards: §f${crate.rewards.length}\n§7Locations: §f${locations.length}`)
      .button("rename", "Rename Display", { iconPath: ICONS.edit })
      .button("setBlock", "Set Crate Block", { iconPath: ICONS.binding })
      .button("setKey", "Set Key Item", { iconPath: ICONS.binding })
      .button("setKeyLore", "Set Key Lore", { iconPath: ICONS.edit })
      .button("setAnimation", "Set Animation Preset", { iconPath: ICONS.settings })
      .button("setParticle", "Set Particle Preset", { iconPath: ICONS.settings })
      .button("toggleRare", `Rare Broadcast: ${crate.broadcastRareWins ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("setRareThreshold", "Set Rare Threshold", { iconPath: ICONS.edit })
      .button("manageRewards", "Manage Rewards", { iconPath: ICONS.shop })
      .button("registerBlock", "Register Looked Block", { iconPath: ICONS.confirm })
      .button("registerCoords", "Register Coordinates", { iconPath: ICONS.confirm })
      .button("removeBlock", "Remove Looked Block", { iconPath: ICONS.delete })
      .button("removeCoords", "Remove Coordinates", { iconPath: ICONS.delete })
      .button("giveKey", "Give Key", { iconPath: ICONS.confirm })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "rename") {
      const result = await TauUi.modal("Rename Crate")
        .text("displayName", "Display name", { placeholder: "Legendary Crate", defaultValue: crate.displayName })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      crate.displayName = String(result.values.displayName ?? crate.displayName).trim() || crate.displayName;
      saveCrates();
      continue;
    }

    if (response.id === "setBlock") {
      const result = await TauUi.modal("Set Crate Block")
        .text("blockId", "Block id", { placeholder: "minecraft:gilded_blackstone", defaultValue: crate.crateBlockId })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      crate.crateBlockId = String(result.values.blockId ?? crate.crateBlockId).trim() || crate.crateBlockId;
      saveCrates();
      continue;
    }

    if (response.id === "setKey") {
      const result = await TauUi.modal("Set Key Item")
        .text("itemId", "Item id", { placeholder: "minecraft:tripwire_hook", defaultValue: crate.keyItemId })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      crate.keyItemId = String(result.values.itemId ?? crate.keyItemId).trim() || crate.keyItemId;
      saveCrates();
      continue;
    }

    if (response.id === "setKeyLore") {
      const result = await TauUi.modal("Set Key Lore")
        .text("loreLine", "Lore line", { placeholder: "§6Legendary Key", defaultValue: crate.keyLoreLine })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      crate.keyLoreLine = String(result.values.loreLine ?? crate.keyLoreLine).trim() || crate.keyLoreLine;
      saveCrates();
      continue;
    }

    if (response.id === "setAnimation") {
      const presets: CrateAnimationPreset[] = ["arcane", "ember", "frost", "void"];
      const result = await TauUi.modal("Set Animation Preset")
        .dropdown("preset", "Preset", presets, presets.indexOf(crate.animationPreset ?? "arcane"))
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const preset = presets[Math.max(0, Math.min(presets.length - 1, Math.floor(Number(result.values.preset ?? 0))))] ?? "arcane";
      crate.animationPreset = preset;
      saveCrates();
      continue;
    }

    if (response.id === "setParticle") {
      const presets = ["arcane", "ember", "frost", "void"];
      const result = await TauUi.modal("Set Particle Preset")
        .dropdown("preset", "Preset", presets, presets.indexOf(crate.particlePreset ?? "arcane"))
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      crate.particlePreset = (["arcane", "ember", "frost", "void"][Math.max(0, Math.min(3, Math.floor(Number(result.values.preset ?? 0))))] ?? "arcane") as any;
      saveCrates();
      continue;
    }

    if (response.id === "toggleRare") {
      crate.broadcastRareWins = !crate.broadcastRareWins;
      saveCrates();
      continue;
    }

    if (response.id === "setRareThreshold") {
      const result = await TauUi.modal("Rare Threshold")
        .text("threshold", "Weight threshold", { placeholder: "5", defaultValue: String(crate.rareBroadcastWeightThreshold) })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const threshold = Math.max(1, Math.floor(Number(result.values.threshold ?? crate.rareBroadcastWeightThreshold)));
      if (Number.isFinite(threshold)) crate.rareBroadcastWeightThreshold = threshold;
      saveCrates();
      continue;
    }

    if (response.id === "manageRewards") {
      await showCrateRewardEditor(player, crate.id);
      continue;
    }

    if (response.id === "registerBlock") {
      const result = setCrateAtBlock(player, crate.id);
      tell(player, result.message);
      continue;
    }

    if (response.id === "registerCoords") {
      const result = await TauUi.modal("Register Coordinates")
        .text("dimensionId", "Dimension id", { placeholder: "minecraft:overworld", defaultValue: player.dimension.id })
        .text("x", "X", { placeholder: "0", defaultValue: String(Math.floor(player.location.x)) })
        .text("y", "Y", { placeholder: "0", defaultValue: String(Math.floor(player.location.y)) })
        .text("z", "Z", { placeholder: "0", defaultValue: String(Math.floor(player.location.z)) })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const dimensionId = String(result.values.dimensionId ?? player.dimension.id).trim() || player.dimension.id;
      const x = Number(result.values.x ?? player.location.x);
      const y = Number(result.values.y ?? player.location.y);
      const z = Number(result.values.z ?? player.location.z);
      const placement = setCrateAtCoordinates(crate.id, dimensionId, x, y, z);
      tell(player, placement.message);
      continue;
    }

    if (response.id === "removeBlock") {
      const result = removeCrateAtBlock(player);
      tell(player, result.message);
      continue;
    }

    if (response.id === "removeCoords") {
      const result = await TauUi.modal("Remove Coordinates")
        .text("dimensionId", "Dimension id", { placeholder: "minecraft:overworld", defaultValue: player.dimension.id })
        .text("x", "X", { placeholder: "0", defaultValue: String(Math.floor(player.location.x)) })
        .text("y", "Y", { placeholder: "0", defaultValue: String(Math.floor(player.location.y)) })
        .text("z", "Z", { placeholder: "0", defaultValue: String(Math.floor(player.location.z)) })
        .submitButton("Remove")
        .show(player);
      if (result.canceled) continue;
      const dimensionId = String(result.values.dimensionId ?? player.dimension.id).trim() || player.dimension.id;
      const x = Math.floor(Number(result.values.x ?? player.location.x));
      const y = Math.floor(Number(result.values.y ?? player.location.y));
      const z = Math.floor(Number(result.values.z ?? player.location.z));
      const key = `${dimensionId}:${x}:${y}:${z}`;
      if (!state.crates.locations[key]) {
        tell(player, "No crate registered at those coordinates.");
        continue;
      }
      delete state.crates.locations[key];
      saveCrates();
      tell(player, "Crate registration removed.");
      continue;
    }

    if (response.id === "giveKey") {
      const result = giveCrateKey(player, crate.id, 1);
      tell(player, result.ok ? result.message : `§c${result.message}`);
      continue;
    }
  }
}

async function showCrateRewardEditor(player: Player, crateId: string) {
  while (true) {
    const crate = state.crates.crates[crateId];
    if (!crate) {
      tell(player, "Crate not found.");
      return;
    }

    const totalWeight = crate.rewards.reduce((sum, reward) => sum + Math.max(0, reward.weight), 0);
    const rewardSummary = crate.rewards.length === 0
      ? "§7No rewards yet."
      : crate.rewards.map((reward, index) => `§7${index + 1}. §f${reward.label} §8(${reward.type}, ${reward.weight}, ${getCrateRewardChanceText(reward, totalWeight)})`).join("\n");

    const response = await TauUi.action(`Rewards: ${crate.displayName}`)
      .body(`Select a reward to edit. Total rewards: ${crate.rewards.length}\n§7Total weight: §f${totalWeight}\n${rewardSummary}`)
      .button("addItem", "Add Item Reward", { iconPath: ICONS.confirm })
      .button("addScore", "Add Score Reward", { iconPath: ICONS.confirm })
      .button("addTag", "Add Tag Reward", { iconPath: ICONS.confirm })
      .button("addCommand", "Add Command Reward", { iconPath: ICONS.confirm })
      .button("edit", "Edit Reward", { iconPath: ICONS.edit })
      .button("delete", "Delete Reward", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "addItem") {
      const result = await TauUi.modal("Add Item Reward")
        .text("label", "Label", { placeholder: "Diamond x8" })
        .text("itemId", "Item id", { placeholder: "minecraft:diamond" })
        .text("amount", "Amount", { placeholder: "8" })
        .text("weight", "Weight", { placeholder: "100" })
        .toggle("useHeld", "Use held item metadata", true)
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      const label = String(result.values.label ?? "").trim();
      const itemId = String(result.values.itemId ?? "").trim();
      const amount = Math.max(1, Math.floor(Number(result.values.amount ?? 1)));
      const weight = Math.max(1, Math.floor(Number(result.values.weight ?? 1)));
      const useHeld = Boolean(result.values.useHeld);
      if (useHeld) {
        const heldReward = heldItemToCrateReward(player, label, weight, amount);
        if (!heldReward) {
          tell(player, "§cNo held item found to copy.");
          continue;
        }
        crate.rewards.push(heldReward);
      } else {
        crate.rewards.push({ type: "item", label, itemId, amount, weight });
      }
      saveCrates();
      continue;
    }

    if (response.id === "addScore") {
      const result = await TauUi.modal("Add Score Reward")
        .text("label", "Label", { placeholder: "$1000" })
        .text("objective", "Objective", { placeholder: "money" })
        .text("amount", "Amount", { placeholder: "1000" })
        .text("weight", "Weight", { placeholder: "10" })
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      crate.rewards.push({ type: "score", label: String(result.values.label ?? "").trim(), objective: String(result.values.objective ?? "").trim(), amount: Math.floor(Number(result.values.amount ?? 1)), weight: Math.max(1, Math.floor(Number(result.values.weight ?? 1))) });
      saveCrates();
      continue;
    }

    if (response.id === "addTag") {
      const result = await TauUi.modal("Add Tag Reward")
        .text("label", "Label", { placeholder: "VIP Tag" })
        .text("tag", "Tag", { placeholder: "tau.vip" })
        .text("weight", "Weight", { placeholder: "1" })
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      crate.rewards.push({ type: "tag", label: String(result.values.label ?? "").trim(), tag: String(result.values.tag ?? "").trim(), weight: Math.max(1, Math.floor(Number(result.values.weight ?? 1))) });
      saveCrates();
      continue;
    }

    if (response.id === "addCommand") {
      const result = await TauUi.modal("Add Command Reward")
        .text("label", "Label", { placeholder: "Run Command" })
        .text("command", "Command", { placeholder: "say hello" })
        .text("weight", "Weight", { placeholder: "1" })
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      crate.rewards.push({ type: "command", label: String(result.values.label ?? "").trim(), command: String(result.values.command ?? "").trim(), weight: Math.max(1, Math.floor(Number(result.values.weight ?? 1))) });
      saveCrates();
      continue;
    }

    if (response.id === "edit" || response.id === "delete") {
      if (crate.rewards.length === 0) continue;
      const isDelete = response.id === "delete";
      const pick = TauUi.action<{ index: number }>(isDelete ? "Delete Reward" : "Edit Reward").body("Select a reward.");
      for (let i = 0; i < crate.rewards.length; i++) {
        pick.button(String(i), `${crate.rewards[i].label} (${crate.rewards[i].type})`, { iconPath: isDelete ? ICONS.delete : ICONS.edit, value: { index: i } });
      }
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      if (isDelete) {
        crate.rewards.splice(picked.value.index, 1);
        saveCrates();
        continue;
      }

      const reward = crate.rewards[picked.value.index];
      if (reward.type === "item") {
        const result = await TauUi.modal("Edit Item Reward")
          .text("label", "Label", { placeholder: "Diamond x8", defaultValue: reward.label })
          .text("itemId", "Item id", { placeholder: "minecraft:diamond", defaultValue: reward.itemId })
          .text("amount", "Amount", { placeholder: "8", defaultValue: String(reward.amount) })
          .text("weight", "Weight", { placeholder: "100", defaultValue: String(reward.weight) })
          .toggle("useHeld", "Use held item metadata", false)
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        reward.label = String(result.values.label ?? reward.label).trim() || reward.label;
        reward.itemId = String(result.values.itemId ?? reward.itemId).trim() || reward.itemId;
        reward.amount = Math.max(1, Math.floor(Number(result.values.amount ?? reward.amount)));
        reward.weight = Math.max(1, Math.floor(Number(result.values.weight ?? reward.weight)));
        if (Boolean(result.values.useHeld)) {
          const heldReward = heldItemToCrateReward(player, reward.label, reward.weight, reward.amount);
          if (heldReward) {
            Object.assign(reward, heldReward);
          }
        }
        saveCrates();
        continue;
      }

      if (reward.type === "score") {
        const result = await TauUi.modal("Edit Score Reward")
          .text("label", "Label", { placeholder: "$1000", defaultValue: reward.label })
          .text("objective", "Objective", { placeholder: "money", defaultValue: reward.objective })
          .text("amount", "Amount", { placeholder: "1000", defaultValue: String(reward.amount) })
          .text("weight", "Weight", { placeholder: "10", defaultValue: String(reward.weight) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        reward.label = String(result.values.label ?? reward.label).trim() || reward.label;
        reward.objective = String(result.values.objective ?? reward.objective).trim() || reward.objective;
        reward.amount = Math.floor(Number(result.values.amount ?? reward.amount));
        reward.weight = Math.max(1, Math.floor(Number(result.values.weight ?? reward.weight)));
        saveCrates();
        continue;
      }

      if (reward.type === "tag") {
        const result = await TauUi.modal("Edit Tag Reward")
          .text("label", "Label", { placeholder: "VIP Tag", defaultValue: reward.label })
          .text("tag", "Tag", { placeholder: "tau.vip", defaultValue: reward.tag })
          .text("weight", "Weight", { placeholder: "1", defaultValue: String(reward.weight) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        reward.label = String(result.values.label ?? reward.label).trim() || reward.label;
        reward.tag = String(result.values.tag ?? reward.tag).trim() || reward.tag;
        reward.weight = Math.max(1, Math.floor(Number(result.values.weight ?? reward.weight)));
        saveCrates();
        continue;
      }

      if (reward.type === "command") {
        const result = await TauUi.modal("Edit Command Reward")
          .text("label", "Label", { placeholder: "Run Command", defaultValue: reward.label })
          .text("command", "Command", { placeholder: "say hello", defaultValue: reward.command })
          .text("weight", "Weight", { placeholder: "1", defaultValue: String(reward.weight) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        reward.label = String(result.values.label ?? reward.label).trim() || reward.label;
        reward.command = String(result.values.command ?? reward.command).trim() || reward.command;
        reward.weight = Math.max(1, Math.floor(Number(result.values.weight ?? reward.weight)));
        saveCrates();
        continue;
      }
    }
  }
}

export async function showCrateAdminMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to manage crates.");
    return;
  }

  while (true) {
    const crateIds = listCrateIds();
    const validCrateIds = crateIds.filter((id) => Boolean(state.crates.crates[id]));
    const response = await TauUi.action("§6Crate Admin§r")
      .body(`§7Manage crate blocks, keys, and rewards.\n§7Enabled: §f${state.crates.config.enabled ? "On" : "Off"}§7 | Crates: §f${validCrateIds.length}§7 | Locations: §f${Object.keys(state.crates.locations).length}`)
      .button("create", "Create Crate", { iconPath: ICONS.confirm })
      .button("edit", "Edit Crate", { iconPath: ICONS.edit })
      .button("delete", "Delete Crate", { iconPath: ICONS.delete })
      .button("toggleEnabled", `Crates Enabled: ${state.crates.config.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "create") {
      const result = await TauUi.modal("Create Crate")
        .text("id", "Id", { placeholder: "legendary" })
        .text("displayName", "Display name", { placeholder: "Legendary Crate" })
        .text("blockId", "Block id", { placeholder: "minecraft:gilded_blackstone" })
        .toggle("useHeldKey", "Use held item as key item", true)
        .toggle("useHeldLore", "Use held item lore", true)
        .text("keyItemId", "Key item id", { placeholder: "minecraft:tripwire_hook" })
        .text("keyLore", "Key lore", { placeholder: "§6Legendary Key" })
        .dropdown("animationPreset", "Animation preset", ["arcane", "ember", "frost", "void"], 0)
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      const id = String(result.values.id ?? "").trim().toLowerCase();
      if (!id) {
        tell(player, "Crate id is required.");
        continue;
      }
      if (state.crates.crates[id]) {
        tell(player, "That crate already exists.");
        continue;
      }
      state.crates.crates[id] = {
        id,
        displayName: String(result.values.displayName ?? "Crate").trim() || "Crate",
        crateBlockId: String(result.values.blockId ?? "minecraft:gilded_blackstone").trim() || "minecraft:gilded_blackstone",
        keyItemId: String(result.values.keyItemId ?? "minecraft:tripwire_hook").trim() || "minecraft:tripwire_hook",
        keyLoreLine: String(result.values.keyLore ?? "§6Key").trim() || "§6Key",
        animationPreset: (["arcane", "ember", "frost", "void"][Math.max(0, Math.min(3, Math.floor(Number(result.values.animationPreset ?? 0))))] ?? "arcane") as CrateAnimationPreset,
        particlePreset: "arcane",
        broadcastRareWins: true,
        rareBroadcastWeightThreshold: 5,
        rewards: [],
      };
      if (Boolean(result.values.useHeldKey)) {
        const held = getHeldItemSnapshot(player);
        if (held) {
          state.crates.crates[id].keyItemId = held.itemId;
          if (Boolean(result.values.useHeldLore) && held.lore && held.lore.length > 0) state.crates.crates[id].keyLoreLine = held.lore[0] ?? state.crates.crates[id].keyLoreLine;
        }
      }
      saveCrates();
      continue;
    }

    if (response.id === "edit") {
      if (crateIds.length === 0) {
        tell(player, "No crates available.");
        continue;
      }
      const pick = TauUi.action<{ crateId: string }>("Edit Crate").body("Select a crate.");
      for (const id of validCrateIds) pick.button(id, state.crates.crates[id].displayName, { iconPath: ICONS.edit, value: { crateId: id } });
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      await showCrateEditor(player, picked.value.crateId);
      continue;
    }

    if (response.id === "delete") {
      if (crateIds.length === 0) {
        tell(player, "No crates available.");
        continue;
      }
      const pick = TauUi.action<{ crateId: string }>("Delete Crate").body("Select a crate to delete.");
      for (const id of validCrateIds) pick.button(id, state.crates.crates[id].displayName, { iconPath: ICONS.delete, value: { crateId: id } });
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const targetId = picked.value.crateId;
      delete state.crates.crates[targetId];
      for (const [key, entry] of Object.entries(state.crates.locations)) {
        if (entry.crateId === targetId) delete state.crates.locations[key];
      }
      saveCrates();
      continue;
    }

    if (response.id === "toggleEnabled") {
      state.crates.config.enabled = !state.crates.config.enabled;
      saveCrates();
      continue;
    }
  }
}

export async function showGeneratorUpgradeMenu(player: Player, defId: string, location: { x: number; y: number; z: number }, dimensionId: string) {
  const def = getGeneratorDefinition(defId);
  if (!def) {
    tell(player, "Generator not found.");
    return;
  }
  const placedInfo = getPlacedGeneratorInfoLines(location, dimensionId);
  const upgrade = getNextUpgradeCost(location, dimensionId);
  const maxTier = def.tiers.reduce((highest, tier) => Math.max(highest, tier.tier), 1);
  const autobreakerCost = getGeneratorAutoBreakerCost(def);
  const placed = getPlacedGeneratorAtLocation(location, dimensionId);
  const autobreakerLine = placed?.autoBreakerPurchased
    ? `§eAutobreaker§r: §f${placed.autoBreakerEnabled ? "On" : "Off"}§7 | Toggle: use the Autobreaker button`
    : upgrade
      ? `§7Autobreaker unlocks at max tier (${maxTier}).`
      : `§eAutobreaker§r: §f$${autobreakerCost}§7 (${def.autoBreakerCost !== undefined ? "custom" : "default"})`;
  const upgradeLine = upgrade
    ? `§eNext upgrade§r: §fTier ${upgrade.nextTier} for $${upgrade.cost}`
    : "§7Max tier reached.";
  const title = `§b${def.name}§r`;

  const response = await TauUi.action(title)
    .body(`${placedInfo.join("\n")}
${upgradeLine}
${autobreakerLine}

Location: ${dimensionId} (${location.x}, ${location.y}, ${location.z})`)
    .button("upgrade", "Upgrade Tier", { iconPath: ICONS.edit })
    .button("toggleAutobreaker", placed?.autoBreakerPurchased ? "Toggle Autobreaker" : (upgrade ? "Autobreaker Locked" : "Buy Autobreaker"), { iconPath: ICONS.settings })
    .button("info", "Info", { iconPath: ICONS.menu })
    .button("pickup", "§cPickup Generator§r", { iconPath: ICONS.delete })
    .button("back", "Back", { iconPath: ICONS.back })
    .show(player);
  if (response.canceled || response.id === undefined) return;

  if (response.id === "upgrade") {
    const confirmed = await TauUi.confirm(player, {
      title: "§cConfirm Upgrade§r",
      body: `§eUpgrade ${def.name}?§r\n${placedInfo.join("\n")}\n§6Price§r: §a$${upgrade?.cost ?? 0}§r`,
      confirmText: "Confirm Upgrade",
      cancelText: "Cancel",
    });
    if (!confirmed) return;
    const upgradeResult = upgradeGenerator(player, location, dimensionId);
    tell(player, upgradeResult.ok ? `§a[Generators] ${upgradeResult.message}` : `§c[Generators] ${upgradeResult.message}`);
    return;
  }
  if (response.id === "toggleAutobreaker") {
    if (!placed?.autoBreakerPurchased && upgrade) {
      tell(player, "§7Autobreaker unlocks after max tier.");
      return;
    }
    const toggle = toggleGeneratorAutoBreaker(player, location, dimensionId);
    tell(player, toggle.ok ? `§a[Generators] ${toggle.message}` : `§c[Generators] ${toggle.message}`);
    return;
  }
  if (response.id === "info") {
    tell(player, getGeneratorInfoLines(def.id).join(" | "));
    return;
  }
  if (response.id === "pickup") {
    const picked = pickupGenerator(player, location, dimensionId);
    tell(player, picked.ok ? `§a[Generators] ${picked.message}` : `§c[Generators] ${picked.message}`);
  }
}


