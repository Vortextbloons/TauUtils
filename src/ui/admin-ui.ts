import { Player, world, ItemStack, EntityComponentTypes, ItemComponentTypes } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ICONS, ICON_DEV_OPTIONS, WORKING_ICON_OPTIONS, isWorkingIconPath, type CrateAnimationPreset, type TauItemConsumptionMode, type TauItemTriggerType, type TauItemAction, type TauItemDefinition, type FormDefinition, type CrateItemReward } from "../types";
import { getInventoryContainer, getPlayerId, isFeatureEnabled, isOperator, normalizeKey, saveBinds, saveChat, saveConfig, saveCrates, saveForms, saveGenerators, saveModeration, savePrune, saveTauItems, state, tell } from "../storage";
import { pruneData, tellPruneResult } from "../prune";
import { addGeneratorTier, createGeneratorDefinition, deleteGeneratorDefinition, getGeneratorAutoBreakerCost, getGeneratorDefinition, getGeneratorInfoLines, getGeneratorTierSummary, getNextUpgradeCost, getPlacedGeneratorAtLocation, getPlacedGeneratorDefinition, getPlacedGeneratorInfoLines, giveGenerator, listGeneratorDefinitions, pickupGenerator, removeGeneratorTier, toggleGeneratorAutoBreaker, updateGeneratorConfig, updateGeneratorDefinition, updateGeneratorTier, upgradeGenerator } from "../generators";
import { giveCrateKey, listCrateIds, removeCrateAtBlock, setCrateAtBlock, setCrateAtCoordinates } from "../crates";
import { createTauItemDefinition, deleteTauItemDefinition, getTauItemDefinition, giveTauItem, listTauItemIds, updateTauItemDefinition } from "../tau-items";
import { getHeldItemSnapshot, heldItemToCrateReward, applyHeldItemSnapshotToGenerator, getOnlinePlayerByName } from "./ui-utils";

function normalizeItemId(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

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
  const totalSlots = Math.max(0, Math.floor(slotCount ?? container.size ?? 0));
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

function getContainerSnapshot(container: { size: number; getItem(slot: number): ItemStack | undefined }): Array<{ slot: number; itemId: string; amount: number; nameTag?: string; lore?: string[] }> {
  const snapshot: Array<{ slot: number; itemId: string; amount: number; nameTag?: string; lore?: string[] }> = [];
  for (let slot = 0; slot < container.size; slot++) {
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
}

function saveModerationInspectionSnapshot(playerName: string, inventory: ReturnType<typeof getContainerSnapshot>, enderChest: ReturnType<typeof getContainerSnapshot>): void {
  state.moderation.inspectionSnapshots ??= {};
  state.moderation.inspectionSnapshots[playerName.toLowerCase()] = {
    playerName,
    updatedAt: Date.now(),
    inventory,
    enderChest,
  };
  saveModeration();
}

function getInspectionSnapshotKey(playerName: string): string {
  return String(playerName ?? "").trim().toLowerCase();
}

function createSnapshotContainer(items: Array<{ slot: number; itemId: string; amount: number; nameTag?: string; lore?: string[] }>): { size: number; getItem(slot: number): ItemStack | undefined; setItem(slot: number, item?: ItemStack): void } {
  return {
    size: Math.max(0, items.reduce((max, entry) => Math.max(max, entry.slot + 1), 0)),
    getItem(slot: number): ItemStack | undefined {
      const entry = items.find((item) => item.slot === slot);
      if (!entry) return undefined;
      const stack = new ItemStack(entry.itemId, entry.amount);
      if (entry.nameTag) stack.nameTag = entry.nameTag;
      if (entry.lore) stack.setLore(entry.lore);
      return stack;
    },
    setItem(slot: number, item?: ItemStack): void {
      const index = items.findIndex((entry) => entry.slot === slot);
      if (!item) {
        if (index >= 0) items.splice(index, 1);
        return;
      }
      const next = {
        slot,
        itemId: item.typeId,
        amount: item.amount,
        nameTag: item.nameTag?.trim() || undefined,
        lore: item.getLore().map((line) => String(line).trim()).filter((line) => line.length > 0),
      };
      if (index >= 0) items[index] = next;
      else items.push(next);
    },
  };
}

function getEnderChestContainer(player: Player): { size: number; getItem(slot: number): ItemStack | undefined; setItem(slot: number, item?: ItemStack): void } | undefined {
  try {
    const ender = player.getComponent("ender_inventory") as { container?: { size: number; getItem(slot: number): ItemStack | undefined; setItem(slot: number, item?: ItemStack): void } } | undefined;
    return ender?.container;
  } catch {
    try {
      const ender = player.getComponent("minecraft:ender_inventory") as { container?: { size: number; getItem(slot: number): ItemStack | undefined; setItem(slot: number, item?: ItemStack): void } } | undefined;
      return ender?.container;
    } catch {
      return undefined;
    }
  }
}

async function showContainerInspector(player: Player, title: string, container: { size: number; getItem(slot: number): ItemStack | undefined; setItem(slot: number, item?: ItemStack): void }, slotCount?: number) {
  while (true) {
    const items = getContainerItems(container, slotCount);
    const form = new ActionFormData()
      .title(title)
      .body(items.length > 0 ? items.map((entry) => formatStackLine(entry.slot, entry.stack)).join("\n") : "§7No items found.")
      .button("Delete Item", ICONS.delete)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined || response.selection === 1) return;

    if (items.length === 0) continue;

    const picker = new ActionFormData().title(`${title} - Delete Item`).body("§7Select an item to delete.");
    for (const entry of items) picker.button(formatStackLine(entry.slot, entry.stack), ICONS.delete);
    picker.button("Back", ICONS.back);
    const picked = await picker.show(player).catch(() => undefined);
    if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= items.length) continue;

    const entry = items[picked.selection];
    container.setItem(entry.slot, undefined);
    tell(player, `§aDeleted ${entry.stack.typeId} from slot ${entry.slot + 1}.`);
  }
}

async function showOnlinePlayerInspector(player: Player) {
  while (true) {
    const online = world.getAllPlayers().filter((entry) => entry.name !== player.name);
    const form = new ActionFormData()
      .title("§cPlayer Inspector§r")
      .body(`§7Online players: §f${online.length}§r`)
      .button("Inventory", ICONS.item)
      .button("Ender Chest", ICONS.utility)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined || response.selection === 2) return;

    if (online.length === 0) {
      tell(player, "No other online players found.");
      continue;
    }

    const picker = new ActionFormData().title("Select Player").body("§7Choose a player to inspect.");
    for (const target of online) picker.button(target.name, ICONS.item);
    picker.button("Back", ICONS.back);
    const picked = await picker.show(player).catch(() => undefined);
    if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= online.length) continue;

    const target = online[picked.selection];
    const snapshotKey = getInspectionSnapshotKey(target.name);
    const inventoryContainer = getInventoryContainer(target);
    const inventorySnapshot = inventoryContainer ? getContainerSnapshot(inventoryContainer) : [];
    const enderContainer = getEnderChestContainer(target);
    const savedSnapshot = state.moderation.inspectionSnapshots?.[snapshotKey];
    const liveEnderSnapshot = enderContainer ? getContainerSnapshot(enderContainer) : [];
    const enderSnapshot = liveEnderSnapshot.length > 0 ? liveEnderSnapshot : (savedSnapshot?.enderChest ?? []);
    saveModerationInspectionSnapshot(target.name, inventorySnapshot, enderSnapshot);

    if (response.selection === 0) {
      const container = inventoryContainer;
      if (!container) {
        tell(player, "That player has no inventory component.");
        continue;
      }
      await showContainerInspector(player, `Inventory: ${target.name}`, container);
      continue;
    }

    const container = enderContainer;
    if (!container) {
      const snapshot = state.moderation.inspectionSnapshots?.[snapshotKey];
      if (snapshot) {
        await showContainerInspector(player, `Ender Chest Snapshot: ${target.name}`, createSnapshotContainer(snapshot.enderChest), 27);
        continue;
      }
      tell(player, "That player has no ender chest component or saved snapshot.");
      continue;
    }
    const currentSnapshot = state.moderation.inspectionSnapshots?.[snapshotKey]?.enderChest;
    if (currentSnapshot && currentSnapshot.length > 0) {
      await showContainerInspector(player, `Ender Chest: ${target.name}`, createSnapshotContainer(currentSnapshot), 27);
      continue;
    }
    await showContainerInspector(player, `Ender Chest: ${target.name}`, container, 27);
  }
}

async function showOfflinePlayerInspector(player: Player) {
  const modal = new ModalFormData()
    .title("Offline Player Inspector")
    .textField("Player name", "Steve")
    .submitButton("Search");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const name = String(result.formValues[0] ?? "").trim();
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

  tell(player, `Saved snapshot for ${snapshot.playerName}: inventory ${snapshot.inventory.length} item(s), ender chest ${snapshot.enderChest.length} item(s).`);
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

  const picker = new ActionFormData().title("§cClean Banned Items§r").body("§7Select a player to clean.§r");
  for (const target of online) picker.button(target.name, ICONS.delete);
  picker.button("Back", ICONS.back);
  const picked = await picker.show(player).catch(() => undefined);
  if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= online.length) return;

  const target = online[picked.selection];
  const removed = clearBannedInventoryItems(target);
  tell(player, removed > 0 ? `§aRemoved ${removed} banned items from ${target.name}.§r` : `§7No banned items found in ${target.name}'s inventory.§r`);
}

export async function showIconDevMenu(player: Player) {
  while (true) {
    const form = new ActionFormData()
      .title("§6Icon Dev§r")
      .body("§7Preview the allowlisted working icons.§r");

    for (const option of ICON_DEV_OPTIONS) {
      form.button(option.label, option.path);
    }
    form.button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection >= ICON_DEV_OPTIONS.length) return;

    const option = ICON_DEV_OPTIONS[response.selection];
    if (!option) continue;

    const preview = new ActionFormData()
      .title(`§6${option.label}§r`)
      .body(`§7Path: §f${option.path ?? "none"}§r`)
      .button("Use This Icon", option.path)
      .button("Back", ICONS.back);

    const previewResponse = await preview.show(player).catch(() => undefined);
    if (!previewResponse || previewResponse.canceled || previewResponse.selection !== 0) continue;
  }
}

export async function showModerationMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to manage moderation settings.");
    return;
  }

  while (true) {
    const banned = state.moderation.bannedItems;
    const form = new ActionFormData()
      .title("§cModeration§r")
      .body(`§7Banned items: §f${banned.length}§r`)
      .button("Add Held Item", ICONS.item)
      .button("List Banned Items", ICONS.menu)
      .button("Clean Player Inventory", ICONS.delete)
      .button("Player Inspector", ICONS.utility)
      .button("Clear Held Item If Banned", ICONS.delete)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 5) return;

    if (response.selection === 0) {
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

    if (response.selection === 1) {
      if (banned.length === 0) {
        tell(player, "No banned items set.");
        continue;
      }
      const pick = new ActionFormData().title("§cBanned Items§r").body("§7Select an item to remove or review.§r");
      for (const entry of banned) {
        pick.button(`§7${entry.itemId}§r${entry.label ? ` - ${entry.label}` : ""}`, ICONS.delete);
      }
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= banned.length) continue;
      const entry = banned[picked.selection];
      const detail = new ActionFormData()
        .title("§cBanned Item§r")
        .body(`§7Item: §f${entry.itemId}\n§7Label: §f${entry.label ?? "None"}\n§7Clear held: §f${entry.clearHeld ? "Yes" : "No"}\n§7Clear inventory: §f${entry.clearInventory ? "Yes" : "No"}`)
        .button("Remove", ICONS.delete)
        .button("Back", ICONS.back);
      const detailResponse = await detail.show(player).catch(() => undefined);
      if (!detailResponse || detailResponse.canceled || detailResponse.selection !== 0) continue;
      state.moderation.bannedItems.splice(picked.selection, 1);
      saveModeration();
      tell(player, `§aRemoved ${entry.itemId} from the banned list.§r`);
      continue;
    }

    if (response.selection === 2) {
      await showModerationPlayerCleaner(player);
      continue;
    }

    if (response.selection === 3) {
      const mode = new ActionFormData()
        .title("Player Inspector")
        .body("§7Choose a target source.")
        .button("Online Players", ICONS.item)
        .button("Offline Player", ICONS.menu)
        .button("Back", ICONS.back);
      const pickedMode = await mode.show(player).catch(() => undefined);
      if (!pickedMode || pickedMode.canceled || pickedMode.selection === undefined || pickedMode.selection === 2) continue;
      if (pickedMode.selection === 0) {
        await showOnlinePlayerInspector(player);
      } else {
        await showOfflinePlayerInspector(player);
      }
      continue;
    }

    if (response.selection === 4) {
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
    const form = new ActionFormData()
      .title("Bindings")
      .button("Set item bind", ICONS.binding)
      .button("Set entity-tag bind", ICONS.binding)
      .button("Set item lore bind", ICONS.edit)
      .button("Set held item lore", ICONS.edit)
      .button("Back", ICONS.back);
    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (response.selection === 0) {
      const modal = new ModalFormData()
        .title("Item Bind")
        .textField("Item type id", "minecraft:clock")
        .textField("Menu id", "main_menu")
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const itemId = String(result.formValues[0] ?? "").trim();
      const menuId = String(result.formValues[1] ?? "").trim();
      if (!itemId || !menuId) continue;
      state.binds.itemBinds[itemId] = menuId;
      state.binds.itemBinds[normalizeKey(itemId)] = menuId;
      saveBinds();
      tell(player, `Bound ${itemId} -> ${menuId}.`);
      continue;
    }

    if (response.selection === 1) {
      const modal = new ModalFormData()
        .title("Entity Tag Bind")
        .textField("Entity tag", "menuid:main_menu")
        .textField("Menu id", "main_menu")
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const tag = String(result.formValues[0] ?? "").trim();
      const menuId = String(result.formValues[1] ?? "").trim();
      if (!tag || !menuId) continue;
      state.binds.entityTagBinds[tag] = menuId;
      saveBinds();
      tell(player, `Bound entity tag ${tag} -> ${menuId}.`);
      continue;
    }

    if (response.selection === 2) {
      const modal = new ModalFormData()
        .title("Lore Item Bind")
        .textField("Menu id", "main_menu")
        .textField("Lore line to match", "Open Menu")
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const menuId = String(result.formValues[0] ?? "").trim();
      const loreLine = String(result.formValues[1] ?? "").trim();
      if (!menuId || !loreLine) continue;
      state.binds.itemBinds[`lore:${loreLine}`] = menuId;
      state.binds.itemBinds[`lore:${normalizeKey(loreLine)}`] = menuId;
      saveBinds();
      tell(player, `Bound lore "${loreLine}" -> ${menuId}.`);
      continue;
    }

    if (response.selection === 3) {
      const { ItemStack } = await import("@minecraft/server");
      const selected = player
        .getComponent((await import("@minecraft/server")).EntityComponentTypes.Inventory)
        ?.container?.getItem(player.selectedSlotIndex);
      if (!selected) {
        tell(player, "Hold an item first.");
        continue;
      }
      const modal = new ModalFormData()
        .title("Set Held Item Lore")
        .textField("Lore lines (one per line)", "Line 1\nLine 2")
        .submitButton("Apply");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const loreText = String(result.formValues[0] ?? "").trim();
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
    const form = new ActionFormData()
      .title("§bTau Config§r")
      .body("Toggle addon features on or off.")
      .button(`Creator: ${features.creator ? "On" : "Off"}`, ICONS.settings)
      .button(`Forms: ${features.forms ? "On" : "Off"}`, ICONS.menu)
      .button(`Shops: ${features.shops ? "On" : "Off"}`, ICONS.shop)
      .button(`Sidebars: ${features.sidebars ? "On" : "Off"}`, ICONS.sidebar)
      .button(`Bindings: ${features.bindings ? "On" : "Off"}`, ICONS.binding)
      .button(`Stats: ${features.stats ? "On" : "Off"}`, ICONS.settings)
      .button(`Plots: ${features.plots ? "On" : "Off"}`, ICONS.sidebar)
      .button(`TPA: ${features.tpa ? "On" : "Off"}`, ICONS.menu)
      .button(`Homes: ${features.homes ? "On" : "Off"}`, ICONS.menu)
      .button(`Pay: ${features.pay ? "On" : "Off"}`, ICONS.shop)
      .button(`Player Config: ${features.playerConfig ? "On" : "Off"}`, ICONS.settings)
      .button(`Teams: ${features.teams ? "On" : "Off"}`, ICONS.menu)
      .button(`Warps: ${features.warps ? "On" : "Off"}`, ICONS.sidebar)
      .button(`Plot TP: ${features.plotTp ? "On" : "Off"}`, ICONS.sidebar)
      .button(`Generators: ${features.generators ? "On" : "Off"}`, ICONS.shop)
      .button(`TauItems: ${features.items ? "On" : "Off"}`, ICONS.utility)
      .button(`Combat: ${features.combat ? "On" : "Off"}`, ICONS.settings)
      .button("Prune Data", ICONS.delete)
      .button("Social Settings", ICONS.settings)
      .button("Combat Settings", ICONS.settings)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 20) return;

    if (response.selection === 19) {
      const { showCombatSettingsAdmin } = await import("./social-ui");
      await showCombatSettingsAdmin(player);
      continue;
    }

    if (response.selection === 18) {
      const { showSocialSettingsAdmin } = await import("./social-ui");
      await showSocialSettingsAdmin(player);
      continue;
    }

    if (response.selection === 17) {
      await showPruneDataMenu(player);
      continue;
    }

    if (response.selection === 12) {
      features.warps = !features.warps;
      saveConfig();
      continue;
    }

    if (response.selection === 13) {
      features.plotTp = !features.plotTp;
      saveConfig();
      continue;
    }

    if (response.selection === 14) {
      features.generators = !features.generators;
      saveConfig();
      continue;
    }

    if (response.selection === 15) {
      features.items = !features.items;
      saveConfig();
      continue;
    }

    if (response.selection === 16) {
      features.combat = !features.combat;
      saveConfig();
      continue;
    }

    const keys: (keyof typeof features)[] = ["creator", "forms", "shops", "sidebars", "bindings", "stats", "plots", "tpa", "homes", "pay", "playerConfig", "teams"];
    const key = keys[response.selection];
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
    const form = new ActionFormData()
      .title("Prune Data")
      .body(`Enabled: ${prune.enabled ? "On" : "Off"}\nInactive days: ${prune.inactiveDays}\nFlags: stats, profiles, teams, plots, homes, tpa, pay, playerSettings`)
      .button(`Enabled: ${prune.enabled ? "On" : "Off"}`, ICONS.settings)
      .button("Set Inactive Days", ICONS.edit)
      .button(`Stats: ${prune.flags.stats ? "On" : "Off"}`, ICONS.menu)
      .button(`Profiles: ${prune.flags.profiles ? "On" : "Off"}`, ICONS.menu)
      .button(`Teams: ${prune.flags.teams ? "On" : "Off"}`, ICONS.menu)
      .button(`Plots: ${prune.flags.plots ? "On" : "Off"}`, ICONS.menu)
      .button(`Homes: ${prune.flags.homes ? "On" : "Off"}`, ICONS.menu)
      .button(`TPA: ${prune.flags.tpa ? "On" : "Off"}`, ICONS.menu)
      .button(`Pay: ${prune.flags.pay ? "On" : "Off"}`, ICONS.shop)
      .button(`Player Settings: ${prune.flags.playerSettings ? "On" : "Off"}`, ICONS.settings)
      .button("Dry Run", ICONS.confirm)
      .button("Execute Prune", ICONS.delete)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (response.selection === 0) {
      prune.enabled = !prune.enabled;
      savePrune();
      continue;
    }
    if (response.selection === 1) {
      const modal = new ModalFormData().title("Inactive Days").textField("Days", "30", { defaultValue: String(prune.inactiveDays) }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const days = Math.max(1, Math.floor(Number(result.formValues[0] ?? 30)));
      if (Number.isFinite(days)) prune.inactiveDays = days;
      savePrune();
      continue;
    }

    const flagKeys: (keyof typeof prune.flags)[] = ["stats", "profiles", "teams", "plots", "homes", "tpa", "pay", "playerSettings"];
    const flagIndex = response.selection - 2;
    if (flagIndex >= 0 && flagIndex < flagKeys.length) {
      const key = flagKeys[flagIndex];
      prune.flags[key] = !prune.flags[key];
      savePrune();
      continue;
    }

    if (response.selection === 10) {
      const result = pruneData(true);
      tellPruneResult(player, result, true);
      continue;
    }
    if (response.selection === 11) {
      const result = pruneData(false);
      tellPruneResult(player, result, false);
      continue;
    }
    if (response.selection === 12) return;
  }
}

export async function showGeneratorMenu(player: Player) {
  while (true) {
    const defs = listGeneratorDefinitions();
    const form = new ActionFormData()
      .title("§bGenerators§r")
      .body("§7Place generators, sneak-left-click to pick them up.§r")
      .button("My Generators", ICONS.menu)
      .button("Place Held Generator", ICONS.confirm)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 2) return;
    if (response.selection === 0) {
      if (defs.length === 0) {
        tell(player, "No generators exist yet.");
        continue;
      }
      const pick = new ActionFormData().title("My Generators").body("Select a generator definition.");
      for (const def of defs) pick.button(def.name, ICONS.menu);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= defs.length) continue;
      const def = defs[picked.selection];
      const info = getGeneratorInfoLines(def.id);
      tell(player, info.join(" | "));
      continue;
    }
    if (response.selection === 1) {
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
  const form = new ActionFormData()
    .title("Simple Action")
    .body("Choose an action type.")
    .button("Command Chain", ICONS.command)
    .button("Sound", ICONS.settings)
    .button("Particle", ICONS.utility)
    .button("Effect", ICONS.settings)
    .button("Projectile", ICONS.binding)
    .button("AOE", ICONS.shop)
    .button("Back", ICONS.back);

  const response = await form.show(player).catch(() => undefined);
  if (!response || response.canceled || response.selection === undefined || response.selection === 6) return undefined;

  if (response.selection === 0) {
    const modal = new ModalFormData()
      .title("Command Chain")
      .textField("Command 1", "say hello")
      .textField("Command 2 (optional)", "")
      .textField("Command 3 (optional)", "")
      .textField("Command 4 (optional)", "")
      .submitButton("Create");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues) return undefined;
    const commands = [String(result.formValues[0] ?? ""), String(result.formValues[1] ?? ""), String(result.formValues[2] ?? ""), String(result.formValues[3] ?? "")].filter((entry) => entry.trim().length > 0);
    return commands.length > 0 ? { type: "command", commands } : undefined;
  }

  if (response.selection === 1) {
    const modal = new ModalFormData()
      .title("Sound")
      .textField("Sound id", "random.levelup")
      .textField("Volume", "1", { defaultValue: "1" })
      .textField("Pitch", "1", { defaultValue: "1" })
      .submitButton("Create");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues) return undefined;
    return { type: "sound", soundId: String(result.formValues[0] ?? "random.levelup"), volume: Number(result.formValues[1] ?? 1), pitch: Number(result.formValues[2] ?? 1) };
  }

  if (response.selection === 2) {
    const options = TAU_ITEM_PARTICLE_OPTIONS.map((entry) => entry.label);
    const modal = new ModalFormData()
      .title("Particle")
      .dropdown("Particle type", options, { defaultValueIndex: 0 })
      .textField("Count", "8", { defaultValue: "8" })
      .textField("Spread", "1.2", { defaultValue: "1.2" })
      .submitButton("Create");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues) return undefined;
    const index = Math.max(0, Math.min(options.length - 1, Math.floor(Number(result.formValues[0] ?? 0))));
    return { type: "particle", particleId: TAU_ITEM_PARTICLE_OPTIONS[index]?.value ?? TAU_ITEM_PARTICLE_OPTIONS[0].value, count: Number(result.formValues[1] ?? 8), spread: Number(result.formValues[2] ?? 1.2) };
  }

  if (response.selection === 3) {
    const modal = new ModalFormData()
      .title("Effect")
      .dropdown("Effect type", TAU_ITEM_EFFECT_OPTIONS, { defaultValueIndex: 0 })
      .textField("Duration ticks", "200", { defaultValue: "200" })
      .textField("Amplifier", "1", { defaultValue: "1" })
      .submitButton("Create");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues) return undefined;
    const index = Math.max(0, Math.min(TAU_ITEM_EFFECT_OPTIONS.length - 1, Math.floor(Number(result.formValues[0] ?? 0))));
    return { type: "effect", effectId: TAU_ITEM_EFFECT_OPTIONS[index] ?? "speed", durationTicks: Number(result.formValues[1] ?? 200), amplifier: Number(result.formValues[2] ?? 0) };
  }

  if (response.selection === 4) {
    const modal = new ModalFormData()
      .title("Projectile")
      .textField("Entity id", "minecraft:snowball")
      .textField("Speed", "1.6", { defaultValue: "1.6" })
      .submitButton("Create");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues) return undefined;
    return { type: "projectile", entityId: String(result.formValues[0] ?? "minecraft:snowball"), speed: Number(result.formValues[1] ?? 1.6) };
  }

  if (response.selection === 5) {
    const modal = new ModalFormData()
      .title("AOE")
      .textField("Radius", "5", { defaultValue: "5" })
      .dropdown("Mode", ["damage", "heal", "knockback"], { defaultValueIndex: 0 })
      .textField("Amount", "4", { defaultValue: "4" })
      .submitButton("Create");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues) return undefined;
    const modeIndex = Math.max(0, Math.min(2, Math.floor(Number(result.formValues[1] ?? 0))));
    return { type: "aoe", radius: Number(result.formValues[0] ?? 5), mode: ["damage", "heal", "knockback"][modeIndex] as any, amount: Number(result.formValues[2] ?? 4) };
  }

  return undefined;
}

async function showTauItemActionCustomCreate(player: Player): Promise<TauItemAction | undefined> {
  const modal = new ModalFormData()
    .title("Custom Action JSON")
    .textField("Action JSON", "{}", { defaultValue: '{"type":"sound","soundId":"random.levelup","volume":1,"pitch":1}' })
    .submitButton("Create");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return undefined;
  return parseSingleActionJson(String(result.formValues[0] ?? "{}"));
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

    const form = new ActionFormData()
      .title(`Actions: ${def.displayName}`)
      .body(`§7Actions: §f${def.actions.length}`)
      .button("Simple Add", ICONS.confirm)
      .button("Custom Add", ICONS.command)
      .button("Edit Action", ICONS.edit)
      .button("Delete Action", ICONS.delete)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 4) return;

    if (response.selection === 0 || response.selection === 1) {
      const action = response.selection === 0 ? await showTauItemActionSimpleCreate(player) : await showTauItemActionCustomCreate(player);
      if (!action) continue;
      def.actions.push(action);
      saveTauItems();
      continue;
    }

    if (response.selection === 2 || response.selection === 3) {
      if (def.actions.length === 0) continue;
      const picker = new ActionFormData().title(response.selection === 2 ? "Edit Action" : "Delete Action").body("Select an action.");
      def.actions.forEach((action, index) => picker.button(`${index + 1}. ${action.type}`, response.selection === 2 ? ICONS.edit : ICONS.delete));
      picker.button("Back", ICONS.back);
      const picked = await picker.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= def.actions.length) continue;
      if (response.selection === 3) {
        def.actions.splice(picked.selection, 1);
        saveTauItems();
        continue;
      }

      const action = def.actions[picked.selection];
      if (action.type === "command") {
        const modal = new ModalFormData()
          .title("Edit Command Chain")
          .textField("Commands (one per line)", "say hello", { defaultValue: serializeCommandList(action.commands) })
          .submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues) continue;
        action.commands = parseCommandList(String(result.formValues[0] ?? ""));
        saveTauItems();
        continue;
      }

      if (action.type === "sound") {
        const modal = new ModalFormData()
          .title("Edit Sound")
          .textField("Sound id", "random.levelup", { defaultValue: action.soundId })
          .textField("Volume", "1", { defaultValue: String(action.volume ?? 1) })
          .textField("Pitch", "1", { defaultValue: String(action.pitch ?? 1) })
          .submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues) continue;
        action.soundId = String(result.formValues[0] ?? action.soundId);
        action.volume = Number(result.formValues[1] ?? action.volume ?? 1);
        action.pitch = Number(result.formValues[2] ?? action.pitch ?? 1);
        saveTauItems();
        continue;
      }

      if (action.type === "particle") {
        const modal = new ModalFormData()
          .title("Edit Particle")
          .dropdown("Particle type", TAU_ITEM_PARTICLE_OPTIONS.map((entry) => entry.label), { defaultValueIndex: Math.max(0, TAU_ITEM_PARTICLE_OPTIONS.findIndex((entry) => entry.value === action.particleId)) })
          .textField("Count", "8", { defaultValue: String(action.count ?? 8) })
          .textField("Spread", "1.2", { defaultValue: String(action.spread ?? 1.2) })
          .submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues) continue;
        const particleIndex = Math.max(0, Math.min(TAU_ITEM_PARTICLE_OPTIONS.length - 1, Math.floor(Number(result.formValues[0] ?? 0))));
        action.particleId = TAU_ITEM_PARTICLE_OPTIONS[particleIndex]?.value ?? action.particleId;
        action.count = Number(result.formValues[1] ?? action.count ?? 8);
        action.spread = Number(result.formValues[2] ?? action.spread ?? 1.2);
        saveTauItems();
        continue;
      }

      if (action.type === "effect") {
        const modal = new ModalFormData()
          .title("Edit Effect")
          .textField("Effect id", "speed", { defaultValue: action.effectId })
          .textField("Duration ticks", "200", { defaultValue: String(action.durationTicks) })
          .textField("Amplifier", "1", { defaultValue: String(action.amplifier ?? 0) })
          .submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues) continue;
        action.effectId = String(result.formValues[0] ?? action.effectId);
        action.durationTicks = Number(result.formValues[1] ?? action.durationTicks);
        action.amplifier = Number(result.formValues[2] ?? action.amplifier ?? 0);
        saveTauItems();
        continue;
      }

      if (action.type === "projectile") {
        const modal = new ModalFormData()
          .title("Edit Projectile")
          .textField("Entity id", "minecraft:snowball", { defaultValue: action.entityId })
          .textField("Speed", "1.6", { defaultValue: String(action.speed ?? 1.6) })
          .submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues) continue;
        action.entityId = String(result.formValues[0] ?? action.entityId);
        action.speed = Number(result.formValues[1] ?? action.speed ?? 1.6);
        saveTauItems();
        continue;
      }

      if (action.type === "aoe") {
        const modal = new ModalFormData()
          .title("Edit AOE")
          .textField("Radius", "5", { defaultValue: String(action.radius) })
          .dropdown("Mode", ["damage", "heal", "knockback"], { defaultValueIndex: ["damage", "heal", "knockback"].indexOf(action.mode) })
          .textField("Amount", "4", { defaultValue: String(action.amount) })
          .submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues) continue;
        action.radius = Number(result.formValues[0] ?? action.radius);
        action.mode = ["damage", "heal", "knockback"][Math.max(0, Math.min(2, Math.floor(Number(result.formValues[1] ?? 0))))] as any;
        action.amount = Number(result.formValues[2] ?? action.amount);
        saveTauItems();
        continue;
      }
    }
  }
}

async function showTauItemTriggerPicker(player: Player, currentTriggers: TauItemTriggerType[]): Promise<TauItemTriggerType[] | undefined> {
  const modal = new ModalFormData()
    .title("Set Triggers")
    .toggle("On use (air)", { defaultValue: currentTriggers.includes("use_air") })
    .toggle("On use (block)", { defaultValue: currentTriggers.includes("use_block") })
    .toggle("On hit (melee)", { defaultValue: currentTriggers.includes("hit_melee") })
    .toggle("On mine (block)", { defaultValue: currentTriggers.includes("mine_block") })
    .submitButton("Save");

  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return undefined;

  const selected: TauItemTriggerType[] = [];
  if (Boolean(result.formValues[0])) selected.push("use_air");
  if (Boolean(result.formValues[1])) selected.push("use_block");
  if (Boolean(result.formValues[2])) selected.push("hit_melee");
  if (Boolean(result.formValues[3])) selected.push("mine_block");
  return selected.length > 0 ? selected : ["use_air"];
}

async function showTauItemTriggerEditor(player: Player, tauItemId: string) {
  while (true) {
    const def = getTauItemDefinition(tauItemId);
    if (!def) {
      tell(player, "TauItem not found.");
      return;
    }

    const form = new ActionFormData()
      .title(`Triggers: ${def.displayName}`)
      .body(`§7Current: §f${def.triggers.join(", ")}`)
      .button("Simple Picker", ICONS.confirm)
      .button("Text / CSV", ICONS.command)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 2) return;

    if (response.selection === 0) {
      const triggers = await showTauItemTriggerPicker(player, def.triggers);
      if (!triggers) continue;
      const res = updateTauItemDefinition(def.id, { triggers });
      tell(player, res.ok ? `§a${res.message}` : `§c${res.message}`);
      continue;
    }

    if (response.selection === 1) {
      const modal = new ModalFormData()
        .title("Set Triggers (Text)")
        .textField("CSV triggers", "use_air,use_block", { defaultValue: def.triggers.join(",") })
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const triggers = parseTriggerCsv(String(result.formValues[0] ?? ""));
      const res = updateTauItemDefinition(def.id, { triggers });
      tell(player, res.ok ? `§a${res.message}` : `§c${res.message}`);
      continue;
    }
  }
}

async function showTauItemCreateSimple(player: Player) {
  const modal = new ModalFormData()
    .title("Create TauItem")
    .textField("Id", "fire_staff")
    .textField("Display name", "§cStaff of Embers")
    .textField("Base item id", "minecraft:stick")
    .textField("Lore description", "Custom Tau item")
    .textField("Cooldown seconds", "5", { defaultValue: "5" })
    .textField("Max uses (0 = none)", "10", { defaultValue: "0" })
    .dropdown("Consumption", TAU_ITEM_CONSUMPTION_OPTIONS, { defaultValueIndex: 0 })
    .toggle("Cancel vanilla behavior", { defaultValue: true })
    .submitButton("Create");

  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;

  const id = String(result.formValues[0] ?? "").trim().toLowerCase();
  const displayName = String(result.formValues[1] ?? "");
  const baseItemId = String(result.formValues[2] ?? "minecraft:stick");
  const loreDescription = String(result.formValues[3] ?? "");
  const cooldownSeconds = Math.max(0, Number(result.formValues[4] ?? 5));
  const maxUses = Math.max(0, Math.floor(Number(result.formValues[5] ?? 0)));
  const consumptionIndex = Math.max(0, Math.min(TAU_ITEM_CONSUMPTION_OPTIONS.length - 1, Math.floor(Number(result.formValues[6] ?? 0))));
  const cancelVanilla = Boolean(result.formValues[7]);

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
  const modal = new ModalFormData()
    .title("Create TauItem (Advanced)")
    .textField("TauItem JSON", "{}", {
      defaultValue: JSON.stringify(defaultTauItemDefinition("fire_staff", "§cStaff of Embers", "minecraft:stick"), null, 2),
    })
    .submitButton("Create");

  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;

  const parsed = parseJsonText<TauItemDefinition>(String(result.formValues[0] ?? "{}"), defaultTauItemDefinition("fire_staff", "§cStaff of Embers", "minecraft:stick"));
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

    const form = new ActionFormData()
      .title(`§6TauItem: ${def.displayName}§r`)
      .body(`§7ID: §f${def.id}\n§7Base item: §f${def.baseItemId}\n§7Triggers: §f${def.triggers.join(", ")}\n§7Cooldown: §f${def.cooldownSeconds}s\n§7Max uses: §f${def.maxUses ?? "none"}\n§7Consumption: §f${def.consumption}\n§7Required tag: §f${def.requiredTag ?? "none"}\n§7Actions: §f${def.actions.length}`)
      .button("Edit Core", ICONS.edit)
      .button("Set Triggers", ICONS.settings)
      .button("Manage Actions", ICONS.edit)
      .button("Give Item", ICONS.confirm)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 4) return;

    if (response.selection === 0) {
      const modal = new ModalFormData()
        .title(`Edit ${def.id}`)
        .textField("Display name", "§cStaff of Embers", { defaultValue: def.displayName })
        .textField("Base item id", "minecraft:stick", { defaultValue: def.baseItemId })
        .textField("Lore description", "Custom Tau item", { defaultValue: def.loreDescription ?? "" })
        .textField("Cooldown seconds", "5", { defaultValue: String(def.cooldownSeconds) })
        .textField("Max uses (0 = none)", "10", { defaultValue: String(def.maxUses ?? 0) })
        .dropdown("Consumption", TAU_ITEM_CONSUMPTION_OPTIONS, { defaultValueIndex: Math.max(0, TAU_ITEM_CONSUMPTION_OPTIONS.indexOf(def.consumption)) })
        .textField("Required player tag (optional)", "class:mage", { defaultValue: def.requiredTag ?? "" })
        .toggle("Cancel vanilla behavior", { defaultValue: def.cancelVanilla !== false })
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const maxUses = Math.max(0, Math.floor(Number(result.formValues[4] ?? 0)));
      const consumptionIndex = Math.max(0, Math.min(TAU_ITEM_CONSUMPTION_OPTIONS.length - 1, Math.floor(Number(result.formValues[5] ?? 0))));
      const res = updateTauItemDefinition(def.id, {
        displayName: String(result.formValues[0] ?? def.displayName),
        baseItemId: String(result.formValues[1] ?? def.baseItemId),
        loreDescription: String(result.formValues[2] ?? def.loreDescription ?? ""),
        cooldownSeconds: Math.max(0, Number(result.formValues[3] ?? def.cooldownSeconds)),
        maxUses: maxUses > 0 ? maxUses : undefined,
        consumption: TAU_ITEM_CONSUMPTION_OPTIONS[consumptionIndex],
        requiredTag: String(result.formValues[6] ?? "").trim() || undefined,
        cancelVanilla: Boolean(result.formValues[7]),
      });
      tell(player, res.ok ? res.message : `§c${res.message}`);
      continue;
    }

    if (response.selection === 1) {
      const modal = new ModalFormData()
        .title("Set Triggers")
        .textField("CSV triggers", "use_air,use_block", { defaultValue: def.triggers.join(",") })
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const triggers = parseTriggerCsv(String(result.formValues[0] ?? ""));
      tell(player, updateTauItemDefinition(def.id, { triggers }).message);
      continue;
    }

    if (response.selection === 2) {
      await showTauItemActionsMenu(player, def.id);
      continue;
    }

    if (response.selection === 3) {
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
    const form = new ActionFormData()
      .title("§6TauItems Admin§r")
      .body(`§7Custom item engine configuration.\n§7Enabled: §f${state.tauItems.config.enabled ? "On" : "Off"}§7 | Items: §f${ids.length}`)
      .button("Create TauItem", ICONS.confirm)
      .button("Advanced Create", ICONS.command)
      .button("Edit TauItem", ICONS.edit)
      .button("Delete TauItem", ICONS.delete)
      .button(`TauItems Enabled: ${state.tauItems.config.enabled ? "On" : "Off"}`, ICONS.settings)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 5) return;

    if (response.selection === 0) {
      await showTauItemCreateSimple(player);
      continue;
    }

    if (response.selection === 1) {
      await showTauItemCreateAdvanced(player);
      continue;
    }

    if (response.selection === 2) {
      if (ids.length === 0) {
        tell(player, "No TauItems available.");
        continue;
      }
      const pick = new ActionFormData().title("Edit TauItem").body("Select an item.");
      for (const id of ids) pick.button(state.tauItems.items[id]?.displayName ?? id, ICONS.edit);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= ids.length) continue;
      await showTauItemEditor(player, ids[picked.selection]);
      continue;
    }

    if (response.selection === 3) {
      if (ids.length === 0) {
        tell(player, "No TauItems available.");
        continue;
      }
      const pick = new ActionFormData().title("Delete TauItem").body("Select an item to delete.");
      for (const id of ids) pick.button(state.tauItems.items[id]?.displayName ?? id, ICONS.delete);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= ids.length) continue;
      const res = deleteTauItemDefinition(ids[picked.selection]);
      tell(player, res.ok ? res.message : `§c${res.message}`);
      continue;
    }

    if (response.selection === 4) {
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
    const form = new ActionFormData()
      .title("§6Generator Admin§r")
      .body(`§7Create and manage generator definitions.\n§7Enabled: §f${state.generators.config.enabled ? "On" : "Off"}§7 | Place anywhere: §f${state.generators.config.defaultPlaceAnywhere ? "On" : "Off"}§7 | Plot-only: §f${state.generators.config.blockOnPlotOnly ? "On" : "Off"}`)
      .button("Create Definition", ICONS.confirm)
      .button("Give Generator", ICONS.binding)
      .button("Edit Definition", ICONS.edit)
      .button("Manage Tiers", ICONS.edit)
      .button("Manage Autobreakers", ICONS.settings)
      .button("Generator Settings", ICONS.settings)
      .button("Delete Definition", ICONS.delete)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 7) return;
    if (response.selection === 0) {
      const modal = new ModalFormData().title("Create Generator").textField("Name", "Diamond Generator").textField("Base item id", "minecraft:bedrock").textField("Output item id", "minecraft:diamond").textField("Rate ticks", "200").submitButton("Create");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const create = createGeneratorDefinition(String(result.formValues[0] ?? ""), String(result.formValues[1] ?? ""), String(result.formValues[2] ?? ""), Number(result.formValues[3] ?? 200));
      if (create.ok) {
        const held = getHeldItemSnapshot(player);
        const def = getGeneratorDefinition(String(result.formValues[0] ?? "").trim().toLowerCase());
        if (def && held) {
          applyHeldItemSnapshotToGenerator(def, held);
          saveGenerators();
        }
      }
      tell(player, create.message);
      continue;
    }
    if (response.selection === 1) {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = new ActionFormData().title("Give Generator").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.name, ICONS.menu);
      targetPick.button("Back", ICONS.back);
      const picked = await targetPick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= defs.length) continue;
      tell(player, giveGenerator(player, defs[picked.selection].id).message);
      continue;
    }
    if (response.selection === 2) {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = new ActionFormData().title("Edit Generator").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.name, ICONS.edit);
      targetPick.button("Back", ICONS.back);
      const picked = await targetPick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= defs.length) continue;
      const def = defs[picked.selection];
      const modal = new ModalFormData()
        .title(`Edit Generator: ${def.name}`)
        .textField("Name", "Diamond Generator", { defaultValue: def.name })
        .textField("Base item id", "minecraft:bedrock", { defaultValue: def.baseItemId })
        .textField("Output item id", "minecraft:diamond", { defaultValue: def.outputItemId })
        .textField("Display name", "Diamond Generator", { defaultValue: def.displayName ?? def.name })
        .textField("Lore (one line per line)", "Line 1|Line 2", { defaultValue: (def.lore ?? []).join("|") })
        .textField("Enchantments (id=level)", "sharpness=1", { defaultValue: (def.enchantments ?? []).map((entry) => `${entry.id}=${entry.level}`).join(",") })
        .textField("Custom data JSON", "{}", { defaultValue: def.customData ?? "{}" })
        .textField("Can place on", "minecraft:stone", { defaultValue: (def.canPlaceOn ?? []).join(",") })
        .textField("Can destroy", "minecraft:glass", { defaultValue: (def.canDestroy ?? []).join(",") })
        .textField("Autobreaker price (blank = default)", String(getGeneratorAutoBreakerCost(def)), { defaultValue: def.autoBreakerCost !== undefined ? String(def.autoBreakerCost) : "" })
        .textField("Durability damage", "0", { defaultValue: String(def.durability ?? 0) })
        .textField("Max durability", "0", { defaultValue: String(def.maxDurability ?? 0) })
        .toggle("Place anywhere", { defaultValue: def.placeAnywhere })
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      tell(player, updateGeneratorDefinition(def.id, {
        name: String(result.formValues[0] ?? def.name),
        baseItemId: String(result.formValues[1] ?? def.baseItemId),
        outputItemId: String(result.formValues[2] ?? def.outputItemId),
        displayName: String(result.formValues[3] ?? def.displayName ?? def.name),
        lore: String(result.formValues[4] ?? "").split("|").map((line) => line.trim()).filter((line) => line.length > 0),
        enchantments: parseEnchantmentsText(String(result.formValues[5] ?? "")),
        customData: String(result.formValues[6] ?? "{}").trim() || undefined,
        canPlaceOn: String(result.formValues[7] ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0),
        canDestroy: String(result.formValues[8] ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0),
        autoBreakerCost: String(result.formValues[9] ?? "").trim().length > 0 ? Number(result.formValues[9]) : undefined,
        durability: Number(result.formValues[10] ?? 0),
        maxDurability: Number(result.formValues[11] ?? 0),
        placeAnywhere: Boolean(result.formValues[12]),
      }).message);
      continue;
    }
    if (response.selection === 3) {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = new ActionFormData().title("Manage Tiers").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.name, ICONS.edit);
      targetPick.button("Back", ICONS.back);
      const picked = await targetPick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= defs.length) continue;
      await showGeneratorTierManager(player, defs[picked.selection].id);
      continue;
    }
    if (response.selection === 4) {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = new ActionFormData().title("Manage Autobreakers").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.name, ICONS.settings);
      targetPick.button("Back", ICONS.back);
      const picked = await targetPick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= defs.length) continue;
      const def = defs[picked.selection];
      const maxTier = def.tiers.reduce((highest, tier) => Math.max(highest, tier.tier), 1);
      const placements = Object.values(state.generators.placed).filter((placed) => placed.definitionId === def.id && placed.tier >= maxTier);
      if (placements.length === 0) {
        tell(player, "No max-tier generators of that definition are placed.");
        continue;
      }
      const placePick = new ActionFormData().title(`Autobreakers: ${def.name}`).body("Select a placed generator to toggle.");
      for (const placed of placements) {
        const status = placed.autoBreakerPurchased ? (placed.autoBreakerEnabled ? "On" : "Off") : "Locked";
        placePick.button(`${placed.dimensionId} @ ${placed.x}, ${placed.y}, ${placed.z} | ${status}`, ICONS.settings);
      }
      placePick.button("Back", ICONS.back);
      const placedPick = await placePick.show(player).catch(() => undefined);
      if (!placedPick || placedPick.canceled || placedPick.selection === undefined || placedPick.selection >= placements.length) continue;
      const placed = placements[placedPick.selection];
      const toggle = toggleGeneratorAutoBreaker(player, { x: placed.x, y: placed.y, z: placed.z }, placed.dimensionId);
      tell(player, toggle.ok ? `§a[Generators] ${toggle.message}` : `§c[Generators] ${toggle.message}`);
      continue;
    }
    if (response.selection === 6) {
      await showGeneratorSettingsMenu(player);
      continue;
    }
    if (response.selection === 5) {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = new ActionFormData().title("Delete Generator").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.name, ICONS.delete);
      targetPick.button("Back", ICONS.back);
      const picked = await targetPick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= defs.length) continue;
      tell(player, deleteGeneratorDefinition(defs[picked.selection].id).message);
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
    const form = new ActionFormData()
      .title(`Tiers: ${def.name}`)
      .body(getGeneratorInfoLines(def.id).join("\n"))
      .button("Add Tier", ICONS.confirm)
      .button("Edit Tier", ICONS.edit)
      .button("Remove Tier", ICONS.delete)
      .button("Set Autobreaker Price", ICONS.settings)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 4) return;

    if (response.selection === 0) {
      const modal = new ModalFormData()
        .title(`Add Tier: ${def.name}`)
        .textField("Rate ticks", "0")
        .textField("Upgrade cost", "1000")
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      tell(player, addGeneratorTier(def.id, Number(result.formValues[0] ?? 200), Number(result.formValues[1] ?? 1000)).message);
      continue;
    }

    if (response.selection === 1) {
      if (tiers.length === 0) continue;
      const pick = new ActionFormData().title(`Edit Tier: ${def.name}`).body("Select a tier to edit.");
      for (const tier of tiers) pick.button(getGeneratorTierSummary(def.id, tier.tier) ?? `Tier ${tier.tier}`, ICONS.edit);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= tiers.length) continue;
      const tier = tiers[picked.selection];
      const modal = new ModalFormData()
        .title(`Edit Tier ${tier.tier}: ${def.name}`)
        .textField("Rate ticks", "0", { defaultValue: String(tier.rateTicks) })
        .textField("Upgrade cost", "1000", { defaultValue: String(tier.upgradeCost) })
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      tell(player, updateGeneratorTier(def.id, tier.tier, {
        rateTicks: Number(result.formValues[0] ?? tier.rateTicks),
        upgradeCost: Number(result.formValues[1] ?? tier.upgradeCost),
      }).message);
      continue;
    }

    if (response.selection === 2) {
      if (tiers.length === 0) continue;
      const pick = new ActionFormData().title(`Remove Tier: ${def.name}`).body("Select a tier to remove.");
      for (const tier of tiers) pick.button(getGeneratorTierSummary(def.id, tier.tier) ?? `Tier ${tier.tier}`, ICONS.delete);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= tiers.length) continue;
      const tier = tiers[picked.selection];
      tell(player, removeGeneratorTier(def.id, tier.tier).message);
      continue;
    }

    if (response.selection === 3) {
      const modal = new ModalFormData()
        .title(`Autobreaker Price: ${def.name}`)
        .textField("Custom autobreaker price (blank = default)", String(getGeneratorAutoBreakerCost(def)), { defaultValue: def.autoBreakerCost !== undefined ? String(def.autoBreakerCost) : "" })
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const raw = String(result.formValues[0] ?? "").trim();
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
    const form = new ActionFormData()
      .title("§bGenerator Settings§r")
      .body(`§7Global generator behavior.§r\n§7Autobreakers: §f${config.autoBreakersEnabled ? "On" : "Off"}`)
      .button(`Generators: ${config.enabled ? "On" : "Off"}`, ICONS.settings)
      .button(`Default place anywhere: ${config.defaultPlaceAnywhere ? "On" : "Off"}`, ICONS.shop)
      .button(`Block on plots only: ${config.blockOnPlotOnly ? "On" : "Off"}`, ICONS.sidebar)
      .button(`Autobreakers: ${config.autoBreakersEnabled ? "On" : "Off"}`, ICONS.confirm)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 4) return;

    if (response.selection === 0) {
      updateGeneratorConfig({ enabled: !config.enabled });
      continue;
    }

    if (response.selection === 1) {
      updateGeneratorConfig({ defaultPlaceAnywhere: !config.defaultPlaceAnywhere });
      continue;
    }

    if (response.selection === 2) {
      updateGeneratorConfig({ blockOnPlotOnly: !config.blockOnPlotOnly });
      continue;
    }

    if (response.selection === 3) {
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
    const form = new ActionFormData()
      .title(`§6Crate: ${crate.displayName}§r`)
      .body(`§7Block: §f${crate.crateBlockId}\n§7Key item: §f${crate.keyItemId}\n§7Key lore: §f${crate.keyLoreLine}\n§7Anim preset: §f${crate.animationPreset}\n§7Particle preset: §f${crate.particlePreset}\n§7Broadcast rare wins: §f${crate.broadcastRareWins ? "On" : "Off"}\n§7Rare threshold: §f${crate.rareBroadcastWeightThreshold}\n§7Rewards: §f${crate.rewards.length}\n§7Locations: §f${locations.length}`)
      .button("Rename Display", ICONS.edit)
      .button("Set Crate Block", ICONS.binding)
      .button("Set Key Item", ICONS.binding)
      .button("Set Key Lore", ICONS.edit)
      .button("Set Animation Preset", ICONS.settings)
      .button("Set Particle Preset", ICONS.settings)
      .button(`Rare Broadcast: ${crate.broadcastRareWins ? "On" : "Off"}`, ICONS.settings)
      .button("Set Rare Threshold", ICONS.edit)
      .button("Manage Rewards", ICONS.shop)
      .button("Register Looked Block", ICONS.confirm)
      .button("Register Coordinates", ICONS.confirm)
      .button("Remove Looked Block", ICONS.delete)
      .button("Remove Coordinates", ICONS.delete)
      .button("Give Key", ICONS.confirm)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 14) return;

    if (response.selection === 0) {
      const modal = new ModalFormData().title("Rename Crate").textField("Display name", "Legendary Crate", { defaultValue: crate.displayName }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      crate.displayName = String(result.formValues[0] ?? crate.displayName).trim() || crate.displayName;
      saveCrates();
      continue;
    }

    if (response.selection === 1) {
      const modal = new ModalFormData().title("Set Crate Block").textField("Block id", "minecraft:gilded_blackstone", { defaultValue: crate.crateBlockId }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      crate.crateBlockId = String(result.formValues[0] ?? crate.crateBlockId).trim() || crate.crateBlockId;
      saveCrates();
      continue;
    }

    if (response.selection === 2) {
      const modal = new ModalFormData().title("Set Key Item").textField("Item id", "minecraft:tripwire_hook", { defaultValue: crate.keyItemId }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      crate.keyItemId = String(result.formValues[0] ?? crate.keyItemId).trim() || crate.keyItemId;
      saveCrates();
      continue;
    }

    if (response.selection === 3) {
      const modal = new ModalFormData().title("Set Key Lore").textField("Lore line", "§6Legendary Key", { defaultValue: crate.keyLoreLine }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      crate.keyLoreLine = String(result.formValues[0] ?? crate.keyLoreLine).trim() || crate.keyLoreLine;
      saveCrates();
      continue;
    }

    if (response.selection === 4) {
      const presets: CrateAnimationPreset[] = ["arcane", "ember", "frost", "void"];
      const modal = new ModalFormData().title("Set Animation Preset").dropdown("Preset", presets, { defaultValueIndex: presets.indexOf(crate.animationPreset ?? "arcane") }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const preset = presets[Math.max(0, Math.min(presets.length - 1, Math.floor(Number(result.formValues[0] ?? 0))))] ?? "arcane";
      crate.animationPreset = preset;
      saveCrates();
      continue;
    }

    if (response.selection === 5) {
      const presets = ["arcane", "ember", "frost", "void"];
      const modal = new ModalFormData().title("Set Particle Preset").dropdown("Preset", presets, { defaultValueIndex: presets.indexOf(crate.particlePreset ?? "arcane") }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      crate.particlePreset = (["arcane", "ember", "frost", "void"][Math.max(0, Math.min(3, Math.floor(Number(result.formValues[0] ?? 0))))] ?? "arcane") as any;
      saveCrates();
      continue;
    }

    if (response.selection === 6) {
      crate.broadcastRareWins = !crate.broadcastRareWins;
      saveCrates();
      continue;
    }

    if (response.selection === 7) {
      const modal = new ModalFormData().title("Rare Threshold").textField("Weight threshold", "5", { defaultValue: String(crate.rareBroadcastWeightThreshold) }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const threshold = Math.max(1, Math.floor(Number(result.formValues[0] ?? crate.rareBroadcastWeightThreshold)));
      if (Number.isFinite(threshold)) crate.rareBroadcastWeightThreshold = threshold;
      saveCrates();
      continue;
    }

    if (response.selection === 8) {
      await showCrateRewardEditor(player, crate.id);
      continue;
    }

    if (response.selection === 9) {
      const result = setCrateAtBlock(player, crate.id);
      tell(player, result.message);
      continue;
    }

    if (response.selection === 10) {
      const modal = new ModalFormData().title("Register Coordinates").textField("Dimension id", "minecraft:overworld", { defaultValue: player.dimension.id }).textField("X", "0", { defaultValue: String(Math.floor(player.location.x)) }).textField("Y", "0", { defaultValue: String(Math.floor(player.location.y)) }).textField("Z", "0", { defaultValue: String(Math.floor(player.location.z)) }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const dimensionId = String(result.formValues[0] ?? player.dimension.id).trim() || player.dimension.id;
      const x = Number(result.formValues[1] ?? player.location.x);
      const y = Number(result.formValues[2] ?? player.location.y);
      const z = Number(result.formValues[3] ?? player.location.z);
      const placement = setCrateAtCoordinates(crate.id, dimensionId, x, y, z);
      tell(player, placement.message);
      continue;
    }

    if (response.selection === 11) {
      const result = removeCrateAtBlock(player);
      tell(player, result.message);
      continue;
    }

    if (response.selection === 12) {
      const modal = new ModalFormData().title("Remove Coordinates").textField("Dimension id", "minecraft:overworld", { defaultValue: player.dimension.id }).textField("X", "0", { defaultValue: String(Math.floor(player.location.x)) }).textField("Y", "0", { defaultValue: String(Math.floor(player.location.y)) }).textField("Z", "0", { defaultValue: String(Math.floor(player.location.z)) }).submitButton("Remove");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const dimensionId = String(result.formValues[0] ?? player.dimension.id).trim() || player.dimension.id;
      const x = Math.floor(Number(result.formValues[1] ?? player.location.x));
      const y = Math.floor(Number(result.formValues[2] ?? player.location.y));
      const z = Math.floor(Number(result.formValues[3] ?? player.location.z));
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

    if (response.selection === 13) {
      const result = giveCrateKey(player, crate.id, 1);
      tell(player, result.ok ? result.message : `§c${result.message}`);
      continue;
    }

    if (response.selection === 14) return;
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

    const form = new ActionFormData()
      .title(`Rewards: ${crate.displayName}`)
      .body(`Select a reward to edit. Total rewards: ${crate.rewards.length}\n§7Total weight: §f${totalWeight}\n${rewardSummary}`)
      .button("Add Item Reward", ICONS.confirm)
      .button("Add Score Reward", ICONS.confirm)
      .button("Add Tag Reward", ICONS.confirm)
      .button("Add Command Reward", ICONS.confirm)
      .button("Edit Reward", ICONS.edit)
      .button("Delete Reward", ICONS.delete)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 6) return;

    if (response.selection === 0) {
      const modal = new ModalFormData().title("Add Item Reward").textField("Label", "Diamond x8").textField("Item id", "minecraft:diamond").textField("Amount", "8").textField("Weight", "100").toggle("Use held item metadata", { defaultValue: true }).submitButton("Create");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const label = String(result.formValues[0] ?? "").trim();
      const itemId = String(result.formValues[1] ?? "").trim();
      const amount = Math.max(1, Math.floor(Number(result.formValues[2] ?? 1)));
      const weight = Math.max(1, Math.floor(Number(result.formValues[3] ?? 1)));
      const useHeld = Boolean(result.formValues[4]);
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

    if (response.selection === 1) {
      const modal = new ModalFormData().title("Add Score Reward").textField("Label", "$1000").textField("Objective", "money").textField("Amount", "1000").textField("Weight", "10").submitButton("Create");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      crate.rewards.push({ type: "score", label: String(result.formValues[0] ?? "").trim(), objective: String(result.formValues[1] ?? "").trim(), amount: Math.floor(Number(result.formValues[2] ?? 1)), weight: Math.max(1, Math.floor(Number(result.formValues[3] ?? 1))) });
      saveCrates();
      continue;
    }

    if (response.selection === 2) {
      const modal = new ModalFormData().title("Add Tag Reward").textField("Label", "VIP Tag").textField("Tag", "tau.vip").textField("Weight", "1").submitButton("Create");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      crate.rewards.push({ type: "tag", label: String(result.formValues[0] ?? "").trim(), tag: String(result.formValues[1] ?? "").trim(), weight: Math.max(1, Math.floor(Number(result.formValues[2] ?? 1))) });
      saveCrates();
      continue;
    }

    if (response.selection === 3) {
      const modal = new ModalFormData().title("Add Command Reward").textField("Label", "Run Command").textField("Command", "say hello").textField("Weight", "1").submitButton("Create");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      crate.rewards.push({ type: "command", label: String(result.formValues[0] ?? "").trim(), command: String(result.formValues[1] ?? "").trim(), weight: Math.max(1, Math.floor(Number(result.formValues[2] ?? 1))) });
      saveCrates();
      continue;
    }

    if (response.selection === 4 || response.selection === 5) {
      if (crate.rewards.length === 0) continue;
      const pick = new ActionFormData().title(response.selection === 4 ? "Edit Reward" : "Delete Reward").body("Select a reward.");
      for (const reward of crate.rewards) pick.button(`${reward.label} (${reward.type})`, response.selection === 4 ? ICONS.edit : ICONS.delete);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= crate.rewards.length) continue;
      if (response.selection === 5) {
        crate.rewards.splice(picked.selection, 1);
        saveCrates();
        continue;
      }

      const reward = crate.rewards[picked.selection];
      if (reward.type === "item") {
        const modal = new ModalFormData().title("Edit Item Reward").textField("Label", "Diamond x8", { defaultValue: reward.label }).textField("Item id", "minecraft:diamond", { defaultValue: reward.itemId }).textField("Amount", "8", { defaultValue: String(reward.amount) }).textField("Weight", "100", { defaultValue: String(reward.weight) }).toggle("Use held item metadata", { defaultValue: false }).submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues) continue;
        reward.label = String(result.formValues[0] ?? reward.label).trim() || reward.label;
        reward.itemId = String(result.formValues[1] ?? reward.itemId).trim() || reward.itemId;
        reward.amount = Math.max(1, Math.floor(Number(result.formValues[2] ?? reward.amount)));
        reward.weight = Math.max(1, Math.floor(Number(result.formValues[3] ?? reward.weight)));
        if (Boolean(result.formValues[4])) {
          const heldReward = heldItemToCrateReward(player, reward.label, reward.weight, reward.amount);
          if (heldReward) {
            Object.assign(reward, heldReward);
          }
        }
        saveCrates();
        continue;
      }

      if (reward.type === "score") {
        const modal = new ModalFormData().title("Edit Score Reward").textField("Label", "$1000", { defaultValue: reward.label }).textField("Objective", "money", { defaultValue: reward.objective }).textField("Amount", "1000", { defaultValue: String(reward.amount) }).textField("Weight", "10", { defaultValue: String(reward.weight) }).submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues) continue;
        reward.label = String(result.formValues[0] ?? reward.label).trim() || reward.label;
        reward.objective = String(result.formValues[1] ?? reward.objective).trim() || reward.objective;
        reward.amount = Math.floor(Number(result.formValues[2] ?? reward.amount));
        reward.weight = Math.max(1, Math.floor(Number(result.formValues[3] ?? reward.weight)));
        saveCrates();
        continue;
      }

      if (reward.type === "tag") {
        const modal = new ModalFormData().title("Edit Tag Reward").textField("Label", "VIP Tag", { defaultValue: reward.label }).textField("Tag", "tau.vip", { defaultValue: reward.tag }).textField("Weight", "1", { defaultValue: String(reward.weight) }).submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues) continue;
        reward.label = String(result.formValues[0] ?? reward.label).trim() || reward.label;
        reward.tag = String(result.formValues[1] ?? reward.tag).trim() || reward.tag;
        reward.weight = Math.max(1, Math.floor(Number(result.formValues[2] ?? reward.weight)));
        saveCrates();
        continue;
      }

      if (reward.type === "command") {
        const modal = new ModalFormData().title("Edit Command Reward").textField("Label", "Run Command", { defaultValue: reward.label }).textField("Command", "say hello", { defaultValue: reward.command }).textField("Weight", "1", { defaultValue: String(reward.weight) }).submitButton("Save");
        const result = await modal.show(player).catch(() => undefined);
        if (!result || result.canceled || !result.formValues) continue;
        reward.label = String(result.formValues[0] ?? reward.label).trim() || reward.label;
        reward.command = String(result.formValues[1] ?? reward.command).trim() || reward.command;
        reward.weight = Math.max(1, Math.floor(Number(result.formValues[2] ?? reward.weight)));
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
    const form = new ActionFormData()
      .title("§6Crate Admin§r")
      .body(`§7Manage crate blocks, keys, and rewards.\n§7Enabled: §f${state.crates.config.enabled ? "On" : "Off"}§7 | Crates: §f${validCrateIds.length}§7 | Locations: §f${Object.keys(state.crates.locations).length}`)
      .button("Create Crate", ICONS.confirm)
      .button("Edit Crate", ICONS.edit)
      .button("Delete Crate", ICONS.delete)
      .button(`Crates Enabled: ${state.crates.config.enabled ? "On" : "Off"}`, ICONS.settings)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 4) return;

    if (response.selection === 0) {
      const modal = new ModalFormData().title("Create Crate").textField("Id", "legendary").textField("Display name", "Legendary Crate").textField("Block id", "minecraft:gilded_blackstone").toggle("Use held item as key item", { defaultValue: true }).toggle("Use held item lore", { defaultValue: true }).textField("Key item id", "minecraft:tripwire_hook").textField("Key lore", "§6Legendary Key").dropdown("Animation preset", ["arcane", "ember", "frost", "void"], { defaultValueIndex: 0 }).submitButton("Create");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const id = String(result.formValues[0] ?? "").trim().toLowerCase();
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
        displayName: String(result.formValues[1] ?? "Crate").trim() || "Crate",
        crateBlockId: String(result.formValues[2] ?? "minecraft:gilded_blackstone").trim() || "minecraft:gilded_blackstone",
        keyItemId: String(result.formValues[5] ?? "minecraft:tripwire_hook").trim() || "minecraft:tripwire_hook",
        keyLoreLine: String(result.formValues[6] ?? "§6Key").trim() || "§6Key",
        animationPreset: (["arcane", "ember", "frost", "void"][Math.max(0, Math.min(3, Math.floor(Number(result.formValues[7] ?? 0))))] ?? "arcane") as CrateAnimationPreset,
        particlePreset: "arcane",
        broadcastRareWins: true,
        rareBroadcastWeightThreshold: 5,
        rewards: [],
      };
      if (Boolean(result.formValues[3])) {
        const held = getHeldItemSnapshot(player);
        if (held) {
          state.crates.crates[id].keyItemId = held.itemId;
          if (Boolean(result.formValues[4]) && held.lore && held.lore.length > 0) state.crates.crates[id].keyLoreLine = held.lore[0] ?? state.crates.crates[id].keyLoreLine;
        }
      }
      saveCrates();
      continue;
    }

    if (response.selection === 1) {
      if (crateIds.length === 0) {
        tell(player, "No crates available.");
        continue;
      }
      const pick = new ActionFormData().title("Edit Crate").body("Select a crate.");
      for (const id of validCrateIds) pick.button(state.crates.crates[id].displayName, ICONS.edit);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= validCrateIds.length) continue;
      await showCrateEditor(player, validCrateIds[picked.selection]);
      continue;
    }

    if (response.selection === 2) {
      if (crateIds.length === 0) {
        tell(player, "No crates available.");
        continue;
      }
      const pick = new ActionFormData().title("Delete Crate").body("Select a crate to delete.");
      for (const id of validCrateIds) pick.button(state.crates.crates[id].displayName, ICONS.delete);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= validCrateIds.length) continue;
      const targetId = validCrateIds[picked.selection];
      delete state.crates.crates[targetId];
      for (const [key, entry] of Object.entries(state.crates.locations)) {
        if (entry.crateId === targetId) delete state.crates.locations[key];
      }
      saveCrates();
      continue;
    }

    if (response.selection === 3) {
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

  const form = new ActionFormData()
    .title(title)
    .body(`${placedInfo.join("\n")}
${upgradeLine}
${autobreakerLine}

Location: ${dimensionId} (${location.x}, ${location.y}, ${location.z})`)
    .button("Upgrade Tier", ICONS.edit)
    .button(placed?.autoBreakerPurchased ? "Toggle Autobreaker" : (upgrade ? "Autobreaker Locked" : "Buy Autobreaker"), ICONS.settings)
    .button("Info", ICONS.menu)
    .button("§cPickup Generator§r", ICONS.delete)
    .button("Back", ICONS.back);

  const response = await form.show(player).catch(() => undefined);
  if (!response || response.canceled || response.selection === undefined) return;

  if (response.selection === 0) {
    const confirm = new ActionFormData()
      .title(`§cConfirm Upgrade§r`)
      .body(`§eUpgrade ${def.name}?§r\n${placedInfo.join("\n")}\n§6Price§r: §a$${upgrade?.cost ?? 0}§r`)
      .button("Confirm Upgrade", ICONS.confirm)
      .button("Cancel", ICONS.back);
    const confirmResponse = await confirm.show(player).catch(() => undefined);
    if (!confirmResponse || confirmResponse.canceled || confirmResponse.selection !== 0) return;
    const upgradeResult = upgradeGenerator(player, location, dimensionId);
    tell(player, upgradeResult.ok ? `§a[Generators] ${upgradeResult.message}` : `§c[Generators] ${upgradeResult.message}`);
    return;
  }
  if (response.selection === 1) {
    if (!placed?.autoBreakerPurchased && upgrade) {
      tell(player, "§7Autobreaker unlocks after max tier.");
      return;
    }
    const toggle = toggleGeneratorAutoBreaker(player, location, dimensionId);
    tell(player, toggle.ok ? `§a[Generators] ${toggle.message}` : `§c[Generators] ${toggle.message}`);
    return;
  }
  if (response.selection === 2) {
    tell(player, getGeneratorInfoLines(def.id).join(" | "));
    return;
  }
  if (response.selection === 3) {
    const picked = pickupGenerator(player, location, dimensionId);
    tell(player, picked.ok ? `§a[Generators] ${picked.message}` : `§c[Generators] ${picked.message}`);
  }
}
