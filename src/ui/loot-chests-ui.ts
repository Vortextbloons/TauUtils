import { Player } from "@minecraft/server";
import { ICONS } from "./icons";
import { isOperator, saveLootChests, state, tell } from "../storage";
import {
  applyLootChestSnapshotToLocation,
  bindLootChestLocation,
  captureLootChestSnapshot,
  createLootChestPool,
  deleteLootChestLocation,
  deleteLootChestPool,
  deleteLootChestSnapshot,
  describeLootChest,
  forceRefillAllLootChests,
  forceRefillLootChest,
  getLookedAtContainerLocation,
  listLootChestLocations,
  listLootChestPools,
  listLootChestSnapshots,
  playerBlockLocation,
  sendLootChestResult,
  updateLootChestLocation,
  updateLootChestPool,
  updateLootChestSnapshot,
} from "../loot-chests";
import type { LootChestRefillMode } from "../types";
import { TauUi } from "./tau-ui";

function parseCoord(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRefillModeLabel(mode: LootChestRefillMode): string {
  return mode === "open" ? "Open triggered" : "Always";
}

function splitCommandLines(value: unknown): string[] {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim().replace(/^\/+/, ""))
    .filter((line) => line.length > 0)
    .slice(0, 10);
}

function getLootChestSnapshotTotalWeight(poolId: string): number {
  return listLootChestSnapshots(poolId)
    .filter((snapshot) => snapshot.enabled && Number.isFinite(snapshot.weight) && snapshot.weight > 0 && snapshot.items.length > 0)
    .reduce((sum, snapshot) => sum + snapshot.weight, 0);
}

function getLootChestSnapshotChanceText(weight: number, totalWeight: number): string {
  if (totalWeight <= 0) return "0%";
  const chance = (weight / totalWeight) * 100;
  return `${chance.toFixed(chance >= 10 ? 1 : 2)}%`;
}

function snapshotSummary(poolId: string): string {
  const snapshots = listLootChestSnapshots(poolId);
  if (snapshots.length === 0) return "§7No snapshots yet.";
  const totalWeight = getLootChestSnapshotTotalWeight(poolId);
  return snapshots
    .slice(0, 12)
    .map((snapshot) => `§f${snapshot.name} §7weight=§e${snapshot.weight} §7(${getLootChestSnapshotChanceText(snapshot.weight, totalWeight)}) §7items=§b${snapshot.items.length} §7${snapshot.enabled ? "ON" : "OFF"}`)
    .join("\n");
}

function snapshotContentsBody(snapshotId: string): string {
  const snapshot = Object.values(state.lootChests.snapshots).find((entry) => `${entry.poolId}:${entry.id}` === snapshotId);
  if (!snapshot) return "Snapshot not found.";
  const lines = [
    `§7Name: §f${snapshot.name}`,
    `§7Weight: §e${snapshot.weight}`,
    `§7Items: §b${snapshot.items.length}`,
  ];
  for (const entry of snapshot.items.slice(0, 20)) {
    const name = entry.item.nameTag?.trim() || entry.item.itemId;
    lines.push(`§7- §f${name} §8x${entry.item.amount} §7(${entry.item.itemId})`);
  }
  if (snapshot.items.length > 20) lines.push(`§7...and ${snapshot.items.length - 20} more`);
  return lines.join("\n");
}

async function promptLocation(player: Player, title: string) {
  const looked = getLookedAtContainerLocation(player);
  const fallback = looked ?? playerBlockLocation(player);
  const result = await TauUi.modal(title)
    .text("dimensionId", "Dimension", { defaultValue: fallback.dimensionId })
    .text("x", "X", { defaultValue: String(fallback.x) })
    .text("y", "Y", { defaultValue: String(fallback.y) })
    .text("z", "Z", { defaultValue: String(fallback.z) })
    .submitButton("Use Location")
    .show(player);
  if (result.canceled) return undefined;
  return {
    dimensionId: String(result.values.dimensionId ?? fallback.dimensionId).trim() || fallback.dimensionId,
    x: parseCoord(result.values.x, fallback.x),
    y: parseCoord(result.values.y, fallback.y),
    z: parseCoord(result.values.z, fallback.z),
  };
}

async function addSnapshotFromLocation(player: Player, poolId: string, location?: ReturnType<typeof playerBlockLocation>): Promise<void> {
  const source = location ?? await promptLocation(player, "Capture Chest Snapshot");
  if (!source) return;
  const defaults = listLootChestSnapshots(poolId).length + 1;
  const details = await TauUi.modal("Snapshot Details")
    .text("name", "Snapshot name", { defaultValue: `Snapshot ${defaults}` })
    .text("weight", "Weight", { defaultValue: "100" })
    .submitButton("Capture")
    .show(player);
  if (details.canceled) return;
  const result = captureLootChestSnapshot(
    poolId,
    source,
    String(details.values.name ?? `Snapshot ${defaults}`),
    Number(details.values.weight ?? 100),
  );
  sendLootChestResult(player, result);
}

async function editSnapshot(player: Player, poolId: string, snapshotId: string): Promise<void> {
  while (true) {
    const snapshot = state.lootChests.snapshots[`${poolId}:${snapshotId}`];
    if (!snapshot) {
      tell(player, "Snapshot not found.");
      return;
    }
    const totalWeight = getLootChestSnapshotTotalWeight(poolId);
    const body = [
      `§7Name: §f${snapshot.name}`,
      `§7Weight: §e${snapshot.weight}`,
      `§7Chance: §f${getLootChestSnapshotChanceText(snapshot.weight, totalWeight)}`,
      `§7Enabled: §f${snapshot.enabled ? "On" : "Off"}`,
      `§7Items: §b${snapshot.items.length}`,
      `§7Source: §8${snapshot.source ? `${snapshot.source.dimensionId} ${snapshot.source.x} ${snapshot.source.y} ${snapshot.source.z}` : "unknown"}`,
    ].join("\n");
    const response = await TauUi.action("Snapshot")
      .body(body)
      .button("edit", "Edit Name / Weight", { iconPath: ICONS.edit })
      .button("preview", "Preview Contents", { iconPath: ICONS.item })
      .button("apply", "Apply To Looked Chest", { iconPath: ICONS.confirm })
      .button("toggle", `Enabled: ${snapshot.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("replace", "Replace From Chest", { iconPath: ICONS.binding })
      .button("delete", "Delete Snapshot", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "edit") {
      const result = await TauUi.modal("Edit Snapshot")
        .text("name", "Name", { defaultValue: snapshot.name })
        .text("weight", "Weight", { defaultValue: String(snapshot.weight) })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      sendLootChestResult(player, updateLootChestSnapshot(poolId, snapshotId, {
        name: String(result.values.name ?? snapshot.name),
        weight: Number(result.values.weight ?? snapshot.weight),
      }));
      continue;
    }
    if (response.id === "toggle") {
      sendLootChestResult(player, updateLootChestSnapshot(poolId, snapshotId, { enabled: !snapshot.enabled }));
      continue;
    }
    if (response.id === "preview") {
      await TauUi.action("Snapshot Contents")
        .body(snapshotContentsBody(`${poolId}:${snapshotId}`))
        .button("back", "Back", { iconPath: ICONS.back })
        .show(player);
      continue;
    }
    if (response.id === "apply") {
      const looked = getLookedAtContainerLocation(player);
      if (!looked) {
        tell(player, "Look at a chest/container first.");
        continue;
      }
      sendLootChestResult(player, applyLootChestSnapshotToLocation(poolId, snapshotId, looked));
      continue;
    }
    if (response.id === "replace") {
      const confirmed = await TauUi.confirm(player, { title: "Replace Snapshot", body: "Delete this snapshot and capture a replacement from a chest?", confirmText: "Replace" });
      if (!confirmed) continue;
      const oldName = snapshot.name;
      const oldWeight = snapshot.weight;
      sendLootChestResult(player, deleteLootChestSnapshot(poolId, snapshotId));
      const location = await promptLocation(player, "Replacement Source Chest");
      if (!location) return;
      sendLootChestResult(player, captureLootChestSnapshot(poolId, location, oldName, oldWeight));
      return;
    }
    if (response.id === "delete") {
      const confirmed = await TauUi.confirm(player, { title: "Delete Snapshot", body: `Delete ${snapshot.name}?`, confirmText: "Delete" });
      if (!confirmed) continue;
      sendLootChestResult(player, deleteLootChestSnapshot(poolId, snapshotId));
      return;
    }
  }
}

async function manageSnapshots(player: Player, poolId: string): Promise<void> {
  while (true) {
    const snapshots = listLootChestSnapshots(poolId);
    const totalWeight = getLootChestSnapshotTotalWeight(poolId);
    const form = TauUi.action<string>("Snapshots").body(snapshotSummary(poolId));
    for (const snapshot of snapshots) form.button("snapshot", `${snapshot.name} (${snapshot.weight}, ${getLootChestSnapshotChanceText(snapshot.weight, totalWeight)})`, { iconPath: ICONS.item, value: snapshot.id });
    form.button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;
    if (response.value) await editSnapshot(player, poolId, response.value);
  }
}

async function editPool(player: Player, poolId: string): Promise<void> {
  while (true) {
    const pool = state.lootChests.pools[poolId];
    if (!pool) return;
    const response = await TauUi.action("Loot Pool")
      .body(`§7Pool: §f${pool.name}\n§7Enabled: §f${pool.enabled ? "On" : "Off"}\n§7Snapshots: §f${pool.snapshotIds.length}\n\n${snapshotSummary(pool.id)}`)
      .button("capture_look", "Capture Looked Chest", { iconPath: ICONS.confirm })
      .button("capture_coords", "Capture From Coordinates", { iconPath: ICONS.binding })
      .button("snapshots", "Manage Snapshots", { iconPath: ICONS.edit })
      .button("rename", "Rename Pool", { iconPath: ICONS.edit })
      .button("toggle", `Enabled: ${pool.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("delete", "Delete Pool", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "capture_look") {
      const location = getLookedAtContainerLocation(player);
      if (!location) tell(player, "Look at a chest/container first.");
      else await addSnapshotFromLocation(player, pool.id, location);
      continue;
    }
    if (response.id === "capture_coords") {
      await addSnapshotFromLocation(player, pool.id);
      continue;
    }
    if (response.id === "snapshots") {
      await manageSnapshots(player, pool.id);
      continue;
    }
    if (response.id === "rename") {
      const result = await TauUi.modal("Rename Pool").text("name", "Name", { defaultValue: pool.name }).submitButton("Save").show(player);
      if (!result.canceled) sendLootChestResult(player, updateLootChestPool(pool.id, { name: String(result.values.name ?? pool.name) }));
      continue;
    }
    if (response.id === "toggle") {
      sendLootChestResult(player, updateLootChestPool(pool.id, { enabled: !pool.enabled }));
      continue;
    }
    if (response.id === "delete") {
      const confirmed = await TauUi.confirm(player, { title: "Delete Pool", body: `Delete ${pool.name}, its snapshots, and bound chests?`, confirmText: "Delete" });
      if (confirmed) {
        sendLootChestResult(player, deleteLootChestPool(pool.id));
        return;
      }
    }
  }
}

async function managePools(player: Player): Promise<void> {
  while (true) {
    const pools = listLootChestPools();
    const form = TauUi.action<string>("Loot Pools").body(`§7Pools: §f${pools.length}`);
    form.button("create", "Create Pool", { iconPath: ICONS.confirm });
    for (const pool of pools) form.button("pool", `${pool.name} (${pool.snapshotIds.length})`, { iconPath: ICONS.menu, value: pool.id });
    form.button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "create") {
      const result = await TauUi.modal("Create Pool").text("name", "Pool name", { defaultValue: "Dungeon Loot" }).submitButton("Create").show(player);
      if (!result.canceled) sendLootChestResult(player, createLootChestPool(String(result.values.name ?? "")));
      continue;
    }
    if (response.value) await editPool(player, response.value);
  }
}

async function bindChest(player: Player, useLookedAt: boolean): Promise<void> {
  const pools = listLootChestPools();
  if (pools.length === 0) {
    tell(player, "Create a loot pool first.");
    return;
  }
  const pick = TauUi.action<string>("Select Pool");
  for (const pool of pools) pick.button("pool", pool.name, { iconPath: ICONS.menu, value: pool.id });
  pick.button("back", "Back", { iconPath: ICONS.back });
  const picked = await pick.show(player);
  if (picked.canceled || !picked.value) return;
  const location = useLookedAt ? getLookedAtContainerLocation(player) : await promptLocation(player, "Bind Loot Chest");
  if (!location) {
    tell(player, "No chest/container selected.");
    return;
  }
  const nameResult = await TauUi.modal("Loot Chest Name")
    .text("name", "Chest name", { defaultValue: `${picked.value} @ ${location.x} ${location.y} ${location.z}` })
    .submitButton("Continue")
    .show(player);
  if (nameResult.canceled) return;
  const name = String(nameResult.values.name ?? "").trim();
  if (!name) {
    tell(player, "Chest name is required.");
    return;
  }
    const result = await TauUi.modal("Loot Chest Settings")
      .text("respawnTicks", "Respawn ticks", { defaultValue: String(state.lootChests.config.defaultRespawnTicks) })
      .dropdown("refillMode", "Refill mode", ["Open triggered", "Always"])
      .toggle("preserveSlots", "Preserve saved slots", true)
      .submitButton("Bind")
      .show(player);
  if (result.canceled) return;
  sendLootChestResult(player, bindLootChestLocation(location, picked.value, {
    name,
    respawnTicks: Number(result.values.respawnTicks ?? state.lootChests.config.defaultRespawnTicks),
    refillMode: (Number(result.values.refillMode ?? 0) === 1 ? "always" : "open") as LootChestRefillMode,
    preserveSlots: result.values.preserveSlots === true,
  }));
}

async function editLocation(player: Player, chestId: string): Promise<void> {
  while (true) {
    const chest = state.lootChests.chests[chestId];
    if (!chest) return;
    const response = await TauUi.action("Loot Chest")
      .body(`§7${describeLootChest(chest)}\n§7Enabled: §f${chest.enabled ? "On" : "Off"}\n§7Respawn: §e${chest.respawnTicks}t\n§7Mode: §f${getRefillModeLabel(chest.refillMode)}\n§7Preserve slots: §f${chest.preserveSlots ? "On" : "Off"}\n§7Message: §f${chest.refillMessageEnabled ? (chest.broadcastRefillMessage ? "Broadcast" : "Nearby") : "Off"}\n§7Commands: §f${chest.refillCommandsEnabled ? `${chest.refillCommands?.length ?? 0} cmd(s)` : "Off"}`)
      .button("settings", "Edit Settings", { iconPath: ICONS.edit })
      .button("message", "Refill Message", { iconPath: ICONS.menu })
      .button("commands", "Refill Commands", { iconPath: ICONS.command })
      .button("force", "Force Refill Now", { iconPath: ICONS.confirm })
      .button("toggle", `Enabled: ${chest.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("delete", "Delete Binding", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "force") {
      sendLootChestResult(player, forceRefillLootChest(chest.id));
      continue;
    }
    if (response.id === "toggle") {
      sendLootChestResult(player, updateLootChestLocation(chest.id, { enabled: !chest.enabled }));
      continue;
    }
    if (response.id === "settings") {
      const result = await TauUi.modal("Edit Loot Chest")
        .text("name", "Chest name", { defaultValue: chest.name })
        .text("respawnTicks", "Respawn ticks", { defaultValue: String(chest.respawnTicks) })
        .dropdown("refillMode", "Refill mode", ["Open triggered", "Always"], chest.refillMode === "always" ? 1 : 0)
        .toggle("preserveSlots", "Preserve saved slots", chest.preserveSlots)
        .submitButton("Save")
        .show(player);
      if (!result.canceled) sendLootChestResult(player, updateLootChestLocation(chest.id, {
        name: String(result.values.name ?? chest.name),
        respawnTicks: Number(result.values.respawnTicks ?? chest.respawnTicks),
        refillMode: (Number(result.values.refillMode ?? 0) === 1 ? "always" : "open") as LootChestRefillMode,
        preserveSlots: result.values.preserveSlots === true,
      }));
      continue;
    }
    if (response.id === "message") {
      const result = await TauUi.modal("Refill Message")
        .toggle("enabled", "Send message on refill", chest.refillMessageEnabled ?? false)
        .toggle("broadcast", "Broadcast to server", chest.broadcastRefillMessage ?? false)
        .text("message", "Message", { defaultValue: chest.refillMessage ?? "§aLoot chest refilled at [x] [y] [z]." })
        .submitButton("Save")
        .show(player);
      if (!result.canceled) sendLootChestResult(player, updateLootChestLocation(chest.id, {
        refillMessageEnabled: result.values.enabled === true,
        broadcastRefillMessage: result.values.broadcast === true,
        refillMessage: String(result.values.message ?? "").trim(),
      }));
      continue;
    }
    if (response.id === "commands") {
      const result = await TauUi.modal("Refill Commands")
        .toggle("enabled", "Run commands on refill", chest.refillCommandsEnabled ?? false)
        .text("commands", "Commands, one per line", { defaultValue: (chest.refillCommands ?? []).join("\n") })
        .submitButton("Save")
        .show(player);
      if (!result.canceled) sendLootChestResult(player, updateLootChestLocation(chest.id, {
        refillCommandsEnabled: result.values.enabled === true,
        refillCommands: splitCommandLines(result.values.commands),
      }));
      continue;
    }
    if (response.id === "delete") {
      const confirmed = await TauUi.confirm(player, { title: "Delete Binding", body: `Delete loot chest binding at ${chest.id}?`, confirmText: "Delete" });
      if (confirmed) {
        sendLootChestResult(player, deleteLootChestLocation(chest.id));
        return;
      }
    }
  }
}

async function manageLocations(player: Player): Promise<void> {
  while (true) {
    const chests = listLootChestLocations();
    const form = TauUi.action<string>("Loot Chest Locations").body(`§7Bound chests: §f${chests.length}`);
    form.button("bind_look", "Bind Looked Chest", { iconPath: ICONS.confirm });
    form.button("bind_coords", "Bind From Coordinates", { iconPath: ICONS.binding });
    for (const chest of chests.slice(0, 40)) form.button("chest", describeLootChest(chest), { iconPath: ICONS.item, value: chest.id });
    form.button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "bind_look") await bindChest(player, true);
    else if (response.id === "bind_coords") await bindChest(player, false);
    else if (response.value) await editLocation(player, response.value);
  }
}

async function lootChestSettings(player: Player): Promise<void> {
  const cfg = state.lootChests.config;
  const result = await TauUi.modal("Loot Chest Settings")
    .toggle("enabled", "Enabled", cfg.enabled)
    .text("processIntervalTicks", "Process interval ticks", { defaultValue: String(cfg.processIntervalTicks) })
    .text("maxRefillsPerTick", "Max refills per tick", { defaultValue: String(cfg.maxRefillsPerTick) })
    .text("defaultRespawnTicks", "Default respawn ticks", { defaultValue: String(cfg.defaultRespawnTicks) })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  cfg.enabled = result.values.enabled === true;
  cfg.processIntervalTicks = Math.max(1, Math.floor(Number(result.values.processIntervalTicks ?? cfg.processIntervalTicks)));
  cfg.maxRefillsPerTick = Math.max(1, Math.floor(Number(result.values.maxRefillsPerTick ?? cfg.maxRefillsPerTick)));
  cfg.defaultRespawnTicks = Math.max(1, Math.floor(Number(result.values.defaultRespawnTicks ?? cfg.defaultRespawnTicks)));
  saveLootChests();
  tell(player, "§aSaved loot chest settings. Restart/reload may be needed for process interval timing changes.");
}

export async function showLootChestsAdminMenu(player: Player): Promise<void> {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to manage loot chests.");
    return;
  }

  while (true) {
    const response = await TauUi.action("Loot Chests Admin")
      .body(`§7Saved full-chest loot snapshots.\n§7Enabled: §f${state.lootChests.config.enabled ? "On" : "Off"}\n§7Pools: §f${Object.keys(state.lootChests.pools).length}§7 | Snapshots: §f${Object.keys(state.lootChests.snapshots).length}§7 | Chests: §f${Object.keys(state.lootChests.chests).length}`)
      .button("pools", "Manage Pools", { iconPath: ICONS.menu })
      .button("locations", "Manage Chest Locations", { iconPath: ICONS.item })
      .button("refillAll", "Force Refill All", { iconPath: ICONS.utility })
      .button("settings", "Settings", { iconPath: ICONS.settings })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "pools") await managePools(player);
    else if (response.id === "locations") await manageLocations(player);
    else if (response.id === "refillAll") {
      const confirmed = await TauUi.confirm(player, {
        title: "Force Refill All",
        body: "Refill every bound loot chest right now? This will overwrite current chest contents.",
        confirmText: "Refill All",
      });
      if (!confirmed) continue;
      const result = forceRefillAllLootChests();
      tell(player, result.ok ? `§a${result.message}` : `§c${result.message}`);
    }
    else if (response.id === "settings") await lootChestSettings(player);
  }
}
