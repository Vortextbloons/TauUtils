import { Player } from "@minecraft/server";
import { TauUi } from "./tau-ui";
import { ICONS, type CustomAreaCommandRule, type CustomAreaDefinition, type CustomAreaEffect } from "../types";
import { isOperator, normalizeKey, saveCustomAreas, state, tell } from "../storage";
import { applyAreaTickingArea, commitCustomArea, invalidateCustomAreaRuntimeState, normalizeAreaBounds } from "../custom-areas";

function parseCoords(raw: string): { ok: boolean; message: string; values?: number[] } {
  const values = raw.trim().split(/[\s,]+/).filter((entry) => entry.length > 0).map((entry) => Number(entry));
  if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) return { ok: false, message: "Enter 6 coordinates: x1 y1 z1 x2 y2 z2." };
  return { ok: true, message: "", values };
}

function defaultPermissions() {
  return { pvp: true, blockBreak: true, blockBreakExceptions: [], blockPlace: true, blockPlaceExceptions: [], itemUse: true, entityInteract: true, teleport: true };
}

function defaultArea(id: string, player: Player, values: number[]): CustomAreaDefinition {
  const bounds = normalizeAreaBounds({ x: values[0]!, y: values[1]!, z: values[2]! }, { x: values[3]!, y: values[4]!, z: values[5]! });
  return {
    id,
    name: id,
    enabled: true,
    dimensionId: player.dimension.id,
    min: bounds.min,
    max: bounds.max,
    priority: 0,
    broadcastMessages: false,
    allowedRanks: [],
    dropItemsIfInCombat: false,
    permissions: defaultPermissions(),
    effects: [],
    commandRules: [],
  };
}

function coords(area: CustomAreaDefinition): string {
  return `${area.min.x} ${area.min.y} ${area.min.z} ${area.max.x} ${area.max.y} ${area.max.z}`;
}

function copyArea(area: CustomAreaDefinition): CustomAreaDefinition {
  return {
    ...area,
    min: { ...area.min },
    max: { ...area.max },
    allowedRanks: [...(area.allowedRanks ?? [])],
    dropItemsIfInCombat: area.dropItemsIfInCombat ?? false,
    permissions: {
      ...(area.permissions ?? defaultPermissions()),
      blockBreakExceptions: [...(area.permissions?.blockBreakExceptions ?? [])],
      blockPlaceExceptions: [...(area.permissions?.blockPlaceExceptions ?? [])],
    },
    commandRules: (area.commandRules ?? []).map((rule) => ({ ...rule, commands: [...(rule.commands ?? [])] })),
    effects: (area.effects ?? []).map((effect) => ({ ...effect })),
    tickingArea: area.tickingArea ? { ...area.tickingArea } : undefined,
  };
}

function parseBlockList(raw: string): string[] {
  return [...new Set(raw.split(",").map((entry) => normalizeKey(entry.trim())).filter((entry) => entry.length > 0))];
}

function getArea(player: Player, areaId: string): CustomAreaDefinition | undefined {
  const area = state.customAreas.areas[areaId];
  if (!area) tell(player, "Area no longer exists.");
  return area;
}

function tellCommitResult(player: Player, result: { ok: boolean; message: string }): void {
  tell(player, `${result.ok ? "§a" : "§c"}${result.message}`);
}

async function createArea(player: Player): Promise<void> {
  if (Object.keys(state.customAreas.areas).length >= state.customAreas.config.maxAreas) {
    tell(player, "Max custom areas reached.");
    return;
  }
  const loc = player.location;
  const defaultCoords = `${Math.floor(loc.x - 5)} ${Math.floor(loc.y - 2)} ${Math.floor(loc.z - 5)} ${Math.floor(loc.x + 5)} ${Math.floor(loc.y + 5)} ${Math.floor(loc.z + 5)}`;
  const result = await TauUi.modal("Create Custom Area")
    .text("areaId", "Area ID", { placeholder: "spawn_safezone" })
    .text("name", "Name", { placeholder: "Spawn Safezone" })
    .text("coords", "Coords", { placeholder: "x1 y1 z1 x2 y2 z2", defaultValue: defaultCoords })
    .text("dimensionId", "Dimension ID", { placeholder: "minecraft:overworld", defaultValue: player.dimension.id })
    .submitButton("Create")
    .show(player);
  if (result.canceled) return;
  const id = normalizeKey(String(result.values.areaId ?? ""));
  if (!id) {
    tell(player, "Area ID is required.");
    return;
  }
  if (state.customAreas.areas[id]) {
    tell(player, "That area ID already exists.");
    return;
  }
  const parsed = parseCoords(String(result.values.coords ?? ""));
  if (!parsed.ok || !parsed.values) {
    tell(player, parsed.message);
    return;
  }
  const area = defaultArea(id, player, parsed.values);
  area.name = String(result.values.name ?? id).trim() || id;
  area.dimensionId = String(result.values.dimensionId ?? player.dimension.id).trim() || player.dimension.id;
  tellCommitResult(player, commitCustomArea(area));
}

async function editBasics(player: Player, areaId: string): Promise<void> {
  const area = getArea(player, areaId);
  if (!area) return;
  const result = await TauUi.modal(`Area: ${area.id}`)
    .text("name", "Name", { placeholder: "Spawn Safezone", defaultValue: area.name })
    .toggle("enabled", "Enabled", area.enabled)
    .text("priority", "Priority", { placeholder: "0", defaultValue: String(area.priority) })
    .text("dimensionId", "Dimension ID", { placeholder: "minecraft:overworld", defaultValue: area.dimensionId })
    .text("coords", "Coords", { placeholder: "x1 y1 z1 x2 y2 z2", defaultValue: coords(area) })
    .text("allowedRanks", "Allowed rank IDs (comma, blank all)", { placeholder: "vip,admin", defaultValue: area.allowedRanks.join(",") })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const parsed = parseCoords(String(result.values.coords ?? ""));
  if (!parsed.ok || !parsed.values) {
    tell(player, parsed.message);
    return;
  }
  const bounds = normalizeAreaBounds({ x: parsed.values[0]!, y: parsed.values[1]!, z: parsed.values[2]! }, { x: parsed.values[3]!, y: parsed.values[4]!, z: parsed.values[5]! });
  const next = copyArea(area);
  next.name = String(result.values.name ?? area.name).trim() || area.name;
  next.enabled = Boolean(result.values.enabled);
  next.priority = Math.floor(Number(result.values.priority ?? 0)) || 0;
  next.dimensionId = String(result.values.dimensionId ?? area.dimensionId).trim() || area.dimensionId;
  next.min = bounds.min;
  next.max = bounds.max;
  next.allowedRanks = String(result.values.allowedRanks ?? "").split(",").map((entry) => normalizeKey(entry.trim())).filter((entry) => entry.length > 0);
  tellCommitResult(player, commitCustomArea(next));
}

async function editMessages(player: Player, areaId: string): Promise<void> {
  const area = getArea(player, areaId);
  if (!area) return;
  const result = await TauUi.modal(`Messages: ${area.name}`)
    .text("enterMessage", "Enter message ({player}, [money], [area], [x])", { placeholder: "Entered [area]", defaultValue: area.enterMessage ?? "" })
    .text("leaveMessage", "Leave message ({player}, [money], [area], [x])", { placeholder: "Left [area]", defaultValue: area.leaveMessage ?? "" })
    .toggle("broadcastMessages", "Broadcast globally", area.broadcastMessages)
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const next = copyArea(getArea(player, areaId) ?? area);
  next.enterMessage = String(result.values.enterMessage ?? "").trim() || undefined;
  next.leaveMessage = String(result.values.leaveMessage ?? "").trim() || undefined;
  next.broadcastMessages = Boolean(result.values.broadcastMessages);
  tellCommitResult(player, commitCustomArea(next));
}

async function editPermissions(player: Player, areaId: string): Promise<void> {
  const area = getArea(player, areaId);
  if (!area) return;
  area.permissions ??= defaultPermissions();
  const result = await TauUi.modal(`Permissions: ${area.name}`)
    .toggle("pvp", "Allow PvP", area.permissions.pvp)
    .toggle("blockBreak", "Allow block breaking", area.permissions.blockBreak)
    .text("blockBreakExceptions", "Break exceptions (comma, only when off)", { placeholder: "minecraft:stone,minecraft:dirt", defaultValue: area.permissions.blockBreakExceptions.join(",") })
    .toggle("blockPlace", "Allow block placing", area.permissions.blockPlace)
    .text("blockPlaceExceptions", "Place exceptions (comma, only when off)", { placeholder: "minecraft:stone,minecraft:dirt", defaultValue: area.permissions.blockPlaceExceptions.join(",") })
    .toggle("itemUse", "Allow item use", area.permissions.itemUse)
    .toggle("entityInteract", "Allow entity interact", area.permissions.entityInteract)
    .toggle("teleport", "Allow teleports into area", area.permissions.teleport ?? true)
    .toggle("dropItemsIfInCombat", "Drop items if in combat", area.dropItemsIfInCombat ?? false)
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const next = copyArea(getArea(player, areaId) ?? area);
  next.permissions = {
    pvp: Boolean(result.values.pvp),
    blockBreak: Boolean(result.values.blockBreak),
    blockBreakExceptions: parseBlockList(String(result.values.blockBreakExceptions ?? "")),
    blockPlace: Boolean(result.values.blockPlace),
    blockPlaceExceptions: parseBlockList(String(result.values.blockPlaceExceptions ?? "")),
    itemUse: Boolean(result.values.itemUse),
    entityInteract: Boolean(result.values.entityInteract),
    teleport: Boolean(result.values.teleport),
  };
  next.dropItemsIfInCombat = Boolean(result.values.dropItemsIfInCombat);
  tellCommitResult(player, commitCustomArea(next));
}

async function addCommandRule(player: Player, area: CustomAreaDefinition, rule?: CustomAreaCommandRule): Promise<void> {
  const result = await TauUi.modal(rule ? "Edit Command Rule" : "Add Command Rule")
    .toggle("enabled", "Enabled", rule?.enabled ?? true)
    .text("commands", "Commands separated by ; ({player}, [money], [area], [x])", { placeholder: "say {player} is in [area]", defaultValue: rule?.commands.join(";") ?? "" })
    .text("intervalTicks", "Interval ticks", { placeholder: "100", defaultValue: String(rule?.intervalTicks ?? 100) })
    .toggle("runOnEnter", "Run on enter", rule?.runOnEnter ?? false)
    .toggle("runOnLeave", "Run on leave", rule?.runOnLeave ?? false)
    .toggle("runWhileInside", "Run while inside", rule?.runWhileInside ?? true)
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const next: CustomAreaCommandRule = {
    enabled: Boolean(result.values.enabled),
    commands: String(result.values.commands ?? "").split(";").map((entry) => entry.trim()).filter((entry) => entry.length > 0).slice(0, state.customAreas.config.maxCommandsPerArea),
    intervalTicks: Math.max(1, Math.floor(Number(result.values.intervalTicks ?? 100))),
    runOnEnter: Boolean(result.values.runOnEnter),
    runOnLeave: Boolean(result.values.runOnLeave),
    runWhileInside: Boolean(result.values.runWhileInside),
  };
  if (next.commands.length === 0) return;
  const nextArea = copyArea(area);
  const index = rule ? area.commandRules.indexOf(rule) : -1;
  if (index >= 0) nextArea.commandRules[index] = next;
  else nextArea.commandRules.push(next);
  tellCommitResult(player, commitCustomArea(nextArea));
}

async function addEffect(player: Player, area: CustomAreaDefinition, effect?: CustomAreaEffect): Promise<void> {
  const result = await TauUi.modal(effect ? "Edit Effect" : "Add Effect")
    .toggle("enabled", "Enabled", effect?.enabled ?? true)
    .text("effectId", "Effect ID", { placeholder: "speed", defaultValue: effect?.effectId ?? "speed" })
    .text("amplifier", "Amplifier", { placeholder: "0", defaultValue: String(effect?.amplifier ?? 0) })
    .text("durationSeconds", "Duration seconds", { placeholder: "5", defaultValue: String(effect?.durationSeconds ?? 5) })
    .text("intervalTicks", "Interval ticks", { placeholder: "80", defaultValue: String(effect?.intervalTicks ?? 80) })
    .toggle("hideParticles", "Hide particles", effect?.hideParticles ?? true)
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const next: CustomAreaEffect = {
    enabled: Boolean(result.values.enabled),
    effectId: String(result.values.effectId ?? "speed").trim() || "speed",
    amplifier: Math.max(0, Math.floor(Number(result.values.amplifier ?? 0))),
    durationSeconds: Math.max(1, Math.floor(Number(result.values.durationSeconds ?? 5))),
    intervalTicks: Math.max(1, Math.floor(Number(result.values.intervalTicks ?? 80))),
    hideParticles: Boolean(result.values.hideParticles),
  };
  const nextArea = copyArea(area);
  const index = effect ? area.effects.indexOf(effect) : -1;
  if (index >= 0) nextArea.effects[index] = next;
  else nextArea.effects.push(next);
  tellCommitResult(player, commitCustomArea(nextArea));
}

async function listEditors<T>(player: Player, title: string, getItems: () => T[], label: (item: T) => string, edit: (item: T) => Promise<void>, add: () => Promise<void>, remove: (index: number) => void, save: () => void): Promise<void> {
  while (true) {
    const items = getItems();
    const form = TauUi.action<{ index: number }>(title).button("add", "Add", { iconPath: ICONS.confirm });
    for (let i = 0; i < items.length; i++) form.button("item", label(items[i]!), { iconPath: ICONS.edit, value: { index: i } });
    form.button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "add") { await add(); continue; }
    const index = response.value!.index;
    const manage = TauUi.action("Manage").button("edit", "Edit", { iconPath: ICONS.edit }).button("delete", "Delete", { iconPath: ICONS.delete }).button("back", "Back", { iconPath: ICONS.back });
    const picked = await manage.show(player);
    if (picked.canceled || picked.id === "back") continue;
    if (picked.id === "delete") { remove(index); save(); continue; }
    await edit(items[index]!);
  }
}

async function editTickingArea(player: Player, areaId: string): Promise<void> {
  const area = getArea(player, areaId);
  if (!area) return;
  const result = await TauUi.modal(`Ticking Area: ${area.name}`)
    .toggle("enabled", "Enabled", area.tickingArea?.enabled ?? false)
    .text("name", "Ticking area name", { placeholder: area.id, defaultValue: area.tickingArea?.name ?? area.id })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const next = copyArea(getArea(player, areaId) ?? area);
  next.tickingArea = { enabled: Boolean(result.values.enabled), name: String(result.values.name ?? area.id).trim() || area.id };
  tellCommitResult(player, commitCustomArea(next));
}

async function editArea(player: Player, areaId: string): Promise<void> {
  while (true) {
    const area = state.customAreas.areas[areaId];
    if (!area) {
      tell(player, "Area no longer exists.");
      return;
    }
    const response = await TauUi.action(area.name)
      .body(`${area.enabled ? "§aEnabled" : "§cDisabled"}§r\n${coords(area)}\nPriority: ${area.priority}\nCombat drop: ${area.dropItemsIfInCombat ? "On (2s grace)" : "Off"}`)
      .button("basics", "Basics / Rank Filter", { iconPath: ICONS.edit })
      .button("messages", "Messages", { iconPath: ICONS.menu })
      .button("permissions", "Permissions", { iconPath: ICONS.settings })
      .button("commands", "Commands", { iconPath: ICONS.binding })
      .button("effects", "Effects", { iconPath: ICONS.utility })
      .button("tickingArea", "Ticking Area", { iconPath: ICONS.sidebar })
      .button("applyTickingArea", "Apply Ticking Area", { iconPath: ICONS.confirm })
      .button("delete", "Delete", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "basics") await editBasics(player, area.id);
    else if (response.id === "messages") await editMessages(player, area.id);
    else if (response.id === "permissions") await editPermissions(player, area.id);
    else if (response.id === "commands") await listEditors(
      player,
      "Command Rules",
      () => getArea(player, area.id)?.commandRules ?? [],
      (rule) => `${rule.enabled ? "ON" : "OFF"} ${rule.commands.length} cmds / ${rule.intervalTicks}t`,
      (rule) => {
        const current = getArea(player, area.id);
        return current ? addCommandRule(player, current, rule) : Promise.resolve();
      },
      () => {
        const current = getArea(player, area.id);
        return current ? addCommandRule(player, current) : Promise.resolve();
      },
      (index) => {
        const current = getArea(player, area.id);
        if (!current) return;
        const next = copyArea(current);
        next.commandRules.splice(index, 1);
        state.customAreas.areas[next.id] = next;
      },
      () => {
        const current = getArea(player, area.id);
        if (current) tellCommitResult(player, commitCustomArea(current));
      }
    );
    else if (response.id === "effects") await listEditors(
      player,
      "Effects",
      () => getArea(player, area.id)?.effects ?? [],
      (effect) => `${effect.enabled ? "ON" : "OFF"} ${effect.effectId} / ${effect.intervalTicks}t`,
      (effect) => {
        const current = getArea(player, area.id);
        return current ? addEffect(player, current, effect) : Promise.resolve();
      },
      () => {
        const current = getArea(player, area.id);
        return current ? addEffect(player, current) : Promise.resolve();
      },
      (index) => {
        const current = getArea(player, area.id);
        if (!current) return;
        const next = copyArea(current);
        next.effects.splice(index, 1);
        state.customAreas.areas[next.id] = next;
      },
      () => {
        const current = getArea(player, area.id);
        if (current) tellCommitResult(player, commitCustomArea(current));
      }
    );
    else if (response.id === "tickingArea") await editTickingArea(player, area.id);
    else if (response.id === "applyTickingArea") tell(player, applyAreaTickingArea(area).message);
    else if (response.id === "delete") { delete state.customAreas.areas[area.id]; saveCustomAreas(); invalidateCustomAreaRuntimeState(area.id); tell(player, "Area deleted."); return; }
    else return;
  }
}

async function globalSettings(player: Player): Promise<void> {
  const cfg = state.customAreas.config;
  const result = await TauUi.modal("Custom Area Settings")
    .toggle("enabled", "Enabled", cfg.enabled)
    .text("checkIntervalTicks", "Check interval ticks", { placeholder: "10", defaultValue: String(cfg.checkIntervalTicks) })
    .text("maxAreas", "Max areas", { placeholder: "250", defaultValue: String(cfg.maxAreas) })
    .text("maxCommandsPerArea", "Max commands per area", { placeholder: "10", defaultValue: String(cfg.maxCommandsPerArea) })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  cfg.enabled = Boolean(result.values.enabled);
  cfg.checkIntervalTicks = Math.max(1, Math.floor(Number(result.values.checkIntervalTicks ?? 10)));
  cfg.maxAreas = Math.max(1, Math.floor(Number(result.values.maxAreas ?? 250)));
  cfg.maxCommandsPerArea = Math.max(1, Math.floor(Number(result.values.maxCommandsPerArea ?? 10)));
  saveCustomAreas();
  invalidateCustomAreaRuntimeState();
}

export async function showCustomAreasAdminMenu(player: Player): Promise<void> {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit custom areas.");
    return;
  }
  while (true) {
    const areas = Object.values(state.customAreas.areas).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const form = TauUi.action<{ areaId: string }>("Custom Areas")
      .body(`Enabled: ${state.customAreas.config.enabled ? "Yes" : "No"}\nAreas: ${areas.length}`)
      .button("globalSettings", "Global Settings", { iconPath: ICONS.settings })
      .button("createArea", "Create Area", { iconPath: ICONS.confirm });
    for (const area of areas) form.button("area", `${area.enabled ? "§aON" : "§cOFF"}§r ${area.name} §7(${area.id})`, { iconPath: ICONS.sidebar, value: { areaId: area.id } });
    form.button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "globalSettings") { await globalSettings(player); continue; }
    if (response.id === "createArea") { await createArea(player); continue; }
    const area = areas.find((a) => a.id === response.value!.areaId);
    if (!area) return;
    await editArea(player, area.id);
  }
}
