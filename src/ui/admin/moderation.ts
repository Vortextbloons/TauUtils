import { Player, system, world, ItemStack, EntityComponentTypes } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS } from "../../types";
import {
  clearBannedInventory,
  isBannedItemId,
  sweepBannedItemsFromOnlinePlayers,
} from "../../moderation/banned-items";
import { getInventoryContainer, isOperator, saveModeration, state, tell } from "../../storage";
import { getOnlinePlayerByName } from "../ui-utils";

type ModerationItemSnapshot = {
  slot: number;
  itemId: string;
  amount: number;
  nameTag?: string;
  lore?: string[];
};

type PlayerInspectionSource = "inventory" | "enderChest";

type SnapshotContainerLike = {
  size: number;
  getItem(slot: number): ItemStack | undefined;
  setItem(slot: number, item?: ItemStack): void;
};

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

function moderationSnapshotsEqual(
  left: ModerationItemSnapshot[] | undefined,
  right: ModerationItemSnapshot[] | undefined,
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const first = a[index];
    const second = b[index];
    if (!second) return false;
    if (first.slot !== second.slot) return false;
    if (first.itemId !== second.itemId) return false;
    if (first.amount !== second.amount) return false;
    if ((first.nameTag ?? "") !== (second.nameTag ?? "")) return false;
    const firstLore = first.lore ?? [];
    const secondLore = second.lore ?? [];
    if (firstLore.length !== secondLore.length) return false;
    for (let loreIndex = 0; loreIndex < firstLore.length; loreIndex++) {
      if (firstLore[loreIndex] !== secondLore[loreIndex]) return false;
    }
  }
  return true;
}

function snapshotToItemStack(snapshot: ModerationItemSnapshot): ItemStack {
  const stack = new ItemStack(snapshot.itemId, snapshot.amount);
  if (snapshot.nameTag) stack.nameTag = snapshot.nameTag;
  if (snapshot.lore && snapshot.lore.length > 0) stack.setLore(snapshot.lore);
  return stack;
}

function createSnapshotContainer(items: ModerationItemSnapshot[]): SnapshotContainerLike {
  const normalize = (): void => {
    items.sort((left, right) => left.slot - right.slot);
  };

  return {
    get size(): number {
      let maxSlot = -1;
      for (const entry of items) {
        if (entry.slot > maxSlot) maxSlot = entry.slot;
      }
      return maxSlot + 1;
    },
    getItem(slot: number): ItemStack | undefined {
      const entry = items.find((item) => item.slot === slot);
      return entry ? snapshotToItemStack(entry) : undefined;
    },
    setItem(slot: number, item?: ItemStack): void {
      const index = items.findIndex((entry) => entry.slot === slot);
      if (!item) {
        if (index >= 0) items.splice(index, 1);
        return;
      }
      const next: ModerationItemSnapshot = {
        slot,
        itemId: item.typeId,
        amount: item.amount,
        nameTag: item.nameTag?.trim() || undefined,
        lore: item.getLore().map((line) => String(line).trim()).filter((line) => line.length > 0),
      };
      if (index >= 0) items[index] = next;
      else items.push(next);
      normalize();
    },
  };
}

function getEnderInventoryContainer(player: Player): SnapshotContainerLike | undefined {
  try {
    const enderInventory = player.getComponent(EntityComponentTypes.EnderInventory);
    return enderInventory?.container;
  } catch {
    return undefined;
  }
}

function saveModerationInspectionSnapshot(playerName: string, inventory?: ModerationItemSnapshot[], enderChest?: ModerationItemSnapshot[]): void {
  state.moderation.inspectionSnapshots ??= {};
  const key = playerName.toLowerCase();
  const current = state.moderation.inspectionSnapshots[key];
  const nextInventory = inventory ?? current?.inventory ?? [];
  const nextEnderChest = enderChest ?? current?.enderChest ?? [];
  if (current && current.playerName === playerName && moderationSnapshotsEqual(current.inventory, nextInventory) && moderationSnapshotsEqual(current.enderChest, nextEnderChest)) {
    return;
  }
  state.moderation.inspectionSnapshots[key] = {
    playerName,
    updatedAt: Date.now(),
    inventory: nextInventory,
    enderChest: nextEnderChest,
  };
  saveModeration();
}

function getInspectionSnapshotKey(playerName: string): string {
  return String(playerName ?? "").trim().toLowerCase();
}

async function showContainerInspector(player: Player, title: string, container: SnapshotContainerLike, slotCount?: number, onMutate?: () => void) {
  while (true) {
    const items = getContainerItems(container, slotCount);
    const res = await TauUi.action(title)
      .body(items.length > 0 ? items.map((entry) => formatStackLine(entry.slot, entry.stack)).join("\n") : "§7No items found.")
      .button("deleteItem", "Delete Item", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(res)) return;

    if (items.length === 0) continue;

    const picker = TauUi.action(`${title} - Delete Item`)
      .body("§7Select an item to delete.");
    for (let i = 0; i < items.length; i++) {
      picker.button(String(i), formatStackLine(items[i].slot, items[i].stack), { iconPath: ICONS.delete });
    }
    picker.button("back", "Back", { iconPath: ICONS.back });
    const picked = await picker.show(player);
    if (TauUi.isCanceledOrBack(picked)) continue;
    const entry = items[parseInt(picked.id as string)];
    if (!entry) continue;
    container.setItem(entry.slot, undefined);
    onMutate?.();
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
      .button("enderChest", "Ender Chest", { iconPath: ICONS.menu })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(res)) return;

    const source: PlayerInspectionSource = res.id === "enderChest" ? "enderChest" : "inventory";

    const picker = TauUi.action<{ name: string }>("Select Player")
      .body(`§7Choose a player to inspect.\n§7Source: §f${source === "inventory" ? "Inventory" : "Ender Chest"}§r`);
    for (const target of targets) {
      picker.button(target.name, target.name, { iconPath: ICONS.item, value: { name: target.name } });
    }
    picker.button("back", "Back", { iconPath: ICONS.back });
    const picked = await picker.show(player);
    if (TauUi.isCanceledOrBack(picked)) continue;

    const target = targets.find((t) => t.name === picked.value!.name)!;
    const inventoryContainer = getInventoryContainer(target);
    const enderChestContainer = getEnderInventoryContainer(target);
    const inventorySnapshot = inventoryContainer ? (getContainerSnapshot(inventoryContainer) ?? []) : undefined;
    const enderChestSnapshot = enderChestContainer ? (getContainerSnapshot(enderChestContainer) ?? []) : undefined;
    saveModerationInspectionSnapshot(target.name, inventorySnapshot, enderChestSnapshot);

    const container = source === "inventory" ? inventoryContainer : enderChestContainer;
    if (!container) {
      tell(player, source === "inventory" ? "That player has no inventory component." : "That player's Ender Chest is unavailable.");
      continue;
    }

    await showContainerInspector(player, source === "inventory" ? `Inventory: ${target.name}` : `Ender Chest: ${target.name}`, container, undefined, () => {
      const refreshedInventory = inventoryContainer ? (getContainerSnapshot(inventoryContainer) ?? []) : undefined;
      const refreshedEnderChest = enderChestContainer ? (getContainerSnapshot(enderChestContainer) ?? []) : undefined;
      saveModerationInspectionSnapshot(target.name, refreshedInventory, refreshedEnderChest);
    });
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
    tell(player, `No offline snapshot is stored for ${name}. Online players can still be inspected.`);
    return;
  }

  const sourceResponse = await TauUi.action("Offline Player Inspector")
    .body(`§7Saved snapshot for §f${snapshot.playerName}§r`)
    .button("inventory", "Inventory", { iconPath: ICONS.item })
    .button("enderChest", "Ender Chest", { iconPath: ICONS.menu })
    .button("back", "Back", { iconPath: ICONS.back })
    .show(player);
  if (TauUi.isCanceledOrBack(sourceResponse)) return;

  const source: PlayerInspectionSource = sourceResponse.id === "enderChest" ? "enderChest" : "inventory";
  const items = source === "inventory" ? snapshot.inventory : snapshot.enderChest;
  const container = createSnapshotContainer(items);
  await showContainerInspector(player, `${source === "inventory" ? "Inventory" : "Ender Chest"}: ${snapshot.playerName} (offline)`, container, undefined, () => saveModeration());
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
  if (TauUi.isCanceledOrBack(picked)) return;

  const target = online[picked.value!.index];
  const removed = clearBannedInventory(target);
  tell(player, removed > 0 ? `§aRemoved ${removed} banned items from ${target.name}.§r` : `§7No banned items found in ${target.name}'s inventory.§r`);
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
    if (TauUi.isCanceledOrBack(response)) return;
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
      const bannedItemId = held.itemId;
      system.run(() => {
        const removed = sweepBannedItemsFromOnlinePlayers();
        tell(
          player,
          removed > 0
            ? `§aBanned ${bannedItemId} and removed ${removed} stack(s) from online players.§r`
            : `§aBanned ${bannedItemId}.§r`
        );
      });
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
      if (TauUi.isCanceledOrBack(picked)) continue;
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
      if (TauUi.isCanceledOrBack(pickedMode)) continue;
      if (pickedMode.id === "online") {
        await showOnlinePlayerInspector(player);
      } else {
        await showOfflinePlayerInspector(player);
      }
      continue;
    }

    if (response.id === "clearHeld") {
      const removed = clearBannedInventory(player);
      tell(player, removed > 0 ? `§aCleared ${removed} banned item(s) from your inventory.§r` : "§7No banned items found in your inventory.§r");
      continue;
    }
  }
}
