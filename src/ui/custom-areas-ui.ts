import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ICONS, type CustomAreaCommandRule, type CustomAreaDefinition, type CustomAreaEffect } from "../types";
import { isOperator, normalizeKey, saveCustomAreas, state, tell } from "../storage";
import { applyAreaTickingArea, commitCustomArea, invalidateCustomAreaRuntimeState, normalizeAreaBounds } from "../custom-areas";

function parseCoords(raw: string): { ok: boolean; message: string; values?: number[] } {
  const values = raw.trim().split(/[\s,]+/).filter((entry) => entry.length > 0).map((entry) => Number(entry));
  if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) return { ok: false, message: "Enter 6 coordinates: x1 y1 z1 x2 y2 z2." };
  return { ok: true, message: "", values };
}

function defaultPermissions() {
  return { pvp: true, blockBreak: true, blockPlace: true, itemUse: true, entityInteract: true };
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
    permissions: { ...(area.permissions ?? defaultPermissions()) },
    commandRules: (area.commandRules ?? []).map((rule) => ({ ...rule, commands: [...(rule.commands ?? [])] })),
    effects: (area.effects ?? []).map((effect) => ({ ...effect })),
    tickingArea: area.tickingArea ? { ...area.tickingArea } : undefined,
  };
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
  const modal = new ModalFormData()
    .title("Create Custom Area")
    .textField("Area ID", "spawn_safezone")
    .textField("Name", "Spawn Safezone")
    .textField("Coords", "x1 y1 z1 x2 y2 z2", { defaultValue: defaultCoords })
    .textField("Dimension ID", "minecraft:overworld", { defaultValue: player.dimension.id })
    .submitButton("Create");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const id = normalizeKey(String(result.formValues[0] ?? ""));
  if (!id) {
    tell(player, "Area ID is required.");
    return;
  }
  if (state.customAreas.areas[id]) {
    tell(player, "That area ID already exists.");
    return;
  }
  const parsed = parseCoords(String(result.formValues[2] ?? ""));
  if (!parsed.ok || !parsed.values) {
    tell(player, parsed.message);
    return;
  }
  const area = defaultArea(id, player, parsed.values);
  area.name = String(result.formValues[1] ?? id).trim() || id;
  area.dimensionId = String(result.formValues[3] ?? player.dimension.id).trim() || player.dimension.id;
  tellCommitResult(player, commitCustomArea(area));
}

async function editBasics(player: Player, areaId: string): Promise<void> {
  const area = getArea(player, areaId);
  if (!area) return;
  const modal = new ModalFormData()
    .title(`Area: ${area.id}`)
    .textField("Name", "Spawn Safezone", { defaultValue: area.name })
    .toggle("Enabled", { defaultValue: area.enabled })
    .textField("Priority", "0", { defaultValue: String(area.priority) })
    .textField("Dimension ID", "minecraft:overworld", { defaultValue: area.dimensionId })
    .textField("Coords", "x1 y1 z1 x2 y2 z2", { defaultValue: coords(area) })
    .textField("Allowed rank IDs (comma, blank all)", "vip,admin", { defaultValue: area.allowedRanks.join(",") })
    .submitButton("Save");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const parsed = parseCoords(String(result.formValues[4] ?? ""));
  if (!parsed.ok || !parsed.values) {
    tell(player, parsed.message);
    return;
  }
  const bounds = normalizeAreaBounds({ x: parsed.values[0]!, y: parsed.values[1]!, z: parsed.values[2]! }, { x: parsed.values[3]!, y: parsed.values[4]!, z: parsed.values[5]! });
  const next = copyArea(area);
  next.name = String(result.formValues[0] ?? area.name).trim() || area.name;
  next.enabled = Boolean(result.formValues[1]);
  next.priority = Math.floor(Number(result.formValues[2] ?? 0)) || 0;
  next.dimensionId = String(result.formValues[3] ?? area.dimensionId).trim() || area.dimensionId;
  next.min = bounds.min;
  next.max = bounds.max;
  next.allowedRanks = String(result.formValues[5] ?? "").split(",").map((entry) => normalizeKey(entry.trim())).filter((entry) => entry.length > 0);
  tellCommitResult(player, commitCustomArea(next));
}

async function editMessages(player: Player, areaId: string): Promise<void> {
  const area = getArea(player, areaId);
  if (!area) return;
  const modal = new ModalFormData()
    .title(`Messages: ${area.name}`)
    .textField("Enter message ({player}, [money], [area], [x])", "Entered [area]", { defaultValue: area.enterMessage ?? "" })
    .textField("Leave message ({player}, [money], [area], [x])", "Left [area]", { defaultValue: area.leaveMessage ?? "" })
    .toggle("Broadcast globally", { defaultValue: area.broadcastMessages })
    .submitButton("Save");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const next = copyArea(getArea(player, areaId) ?? area);
  next.enterMessage = String(result.formValues[0] ?? "").trim() || undefined;
  next.leaveMessage = String(result.formValues[1] ?? "").trim() || undefined;
  next.broadcastMessages = Boolean(result.formValues[2]);
  tellCommitResult(player, commitCustomArea(next));
}

async function editPermissions(player: Player, areaId: string): Promise<void> {
  const area = getArea(player, areaId);
  if (!area) return;
  area.permissions ??= defaultPermissions();
  const modal = new ModalFormData()
    .title(`Permissions: ${area.name}`)
    .toggle("Allow PvP", { defaultValue: area.permissions.pvp })
    .toggle("Allow block breaking", { defaultValue: area.permissions.blockBreak })
    .toggle("Allow block placing", { defaultValue: area.permissions.blockPlace })
    .toggle("Allow item use", { defaultValue: area.permissions.itemUse })
    .toggle("Allow entity interact", { defaultValue: area.permissions.entityInteract })
    .toggle("Drop items if in combat", { defaultValue: area.dropItemsIfInCombat ?? false })
    .submitButton("Save");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const next = copyArea(getArea(player, areaId) ?? area);
  next.permissions = {
    pvp: Boolean(result.formValues[0]),
    blockBreak: Boolean(result.formValues[1]),
    blockPlace: Boolean(result.formValues[2]),
    itemUse: Boolean(result.formValues[3]),
    entityInteract: Boolean(result.formValues[4]),
  };
  next.dropItemsIfInCombat = Boolean(result.formValues[5]);
  tellCommitResult(player, commitCustomArea(next));
}

async function addCommandRule(player: Player, area: CustomAreaDefinition, rule?: CustomAreaCommandRule): Promise<void> {
  const modal = new ModalFormData()
    .title(rule ? "Edit Command Rule" : "Add Command Rule")
    .toggle("Enabled", { defaultValue: rule?.enabled ?? true })
    .textField("Commands separated by ; ({player}, [money], [area], [x])", "say {player} is in [area]", { defaultValue: rule?.commands.join(";") ?? "" })
    .textField("Interval ticks", "100", { defaultValue: String(rule?.intervalTicks ?? 100) })
    .toggle("Run on enter", { defaultValue: rule?.runOnEnter ?? false })
    .toggle("Run on leave", { defaultValue: rule?.runOnLeave ?? false })
    .toggle("Run while inside", { defaultValue: rule?.runWhileInside ?? true })
    .submitButton("Save");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const next: CustomAreaCommandRule = {
    enabled: Boolean(result.formValues[0]),
    commands: String(result.formValues[1] ?? "").split(";").map((entry) => entry.trim()).filter((entry) => entry.length > 0).slice(0, state.customAreas.config.maxCommandsPerArea),
    intervalTicks: Math.max(1, Math.floor(Number(result.formValues[2] ?? 100))),
    runOnEnter: Boolean(result.formValues[3]),
    runOnLeave: Boolean(result.formValues[4]),
    runWhileInside: Boolean(result.formValues[5]),
  };
  if (next.commands.length === 0) return;
  const nextArea = copyArea(area);
  const index = rule ? area.commandRules.indexOf(rule) : -1;
  if (index >= 0) nextArea.commandRules[index] = next;
  else nextArea.commandRules.push(next);
  tellCommitResult(player, commitCustomArea(nextArea));
}

async function addEffect(player: Player, area: CustomAreaDefinition, effect?: CustomAreaEffect): Promise<void> {
  const modal = new ModalFormData()
    .title(effect ? "Edit Effect" : "Add Effect")
    .toggle("Enabled", { defaultValue: effect?.enabled ?? true })
    .textField("Effect ID", "speed", { defaultValue: effect?.effectId ?? "speed" })
    .textField("Amplifier", "0", { defaultValue: String(effect?.amplifier ?? 0) })
    .textField("Duration seconds", "5", { defaultValue: String(effect?.durationSeconds ?? 5) })
    .textField("Interval ticks", "80", { defaultValue: String(effect?.intervalTicks ?? 80) })
    .toggle("Hide particles", { defaultValue: effect?.hideParticles ?? true })
    .submitButton("Save");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const next: CustomAreaEffect = {
    enabled: Boolean(result.formValues[0]),
    effectId: String(result.formValues[1] ?? "speed").trim() || "speed",
    amplifier: Math.max(0, Math.floor(Number(result.formValues[2] ?? 0))),
    durationSeconds: Math.max(1, Math.floor(Number(result.formValues[3] ?? 5))),
    intervalTicks: Math.max(1, Math.floor(Number(result.formValues[4] ?? 80))),
    hideParticles: Boolean(result.formValues[5]),
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
    const form = new ActionFormData().title(title).button("Add", ICONS.confirm);
    for (const item of items) form.button(label(item), ICONS.edit);
    form.button("Back", ICONS.back);
    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 0) { await add(); continue; }
    const index = response.selection - 1;
    if (index >= items.length) return;
    const manage = new ActionFormData().title("Manage").button("Edit", ICONS.edit).button("Delete", ICONS.delete).button("Back", ICONS.back);
    const picked = await manage.show(player).catch(() => undefined);
    if (!picked || picked.canceled || picked.selection === undefined || picked.selection === 2) continue;
    if (picked.selection === 1) { remove(index); save(); continue; }
    await edit(items[index]!);
  }
}

async function editTickingArea(player: Player, areaId: string): Promise<void> {
  const area = getArea(player, areaId);
  if (!area) return;
  const modal = new ModalFormData()
    .title(`Ticking Area: ${area.name}`)
    .toggle("Enabled", { defaultValue: area.tickingArea?.enabled ?? false })
    .textField("Ticking area name", area.id, { defaultValue: area.tickingArea?.name ?? area.id })
    .submitButton("Save");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const next = copyArea(getArea(player, areaId) ?? area);
  next.tickingArea = { enabled: Boolean(result.formValues[0]), name: String(result.formValues[1] ?? area.id).trim() || area.id };
  tellCommitResult(player, commitCustomArea(next));
}

async function editArea(player: Player, areaId: string): Promise<void> {
  while (true) {
    const area = state.customAreas.areas[areaId];
    if (!area) {
      tell(player, "Area no longer exists.");
      return;
    }
    const form = new ActionFormData()
      .title(area.name)
      .body(`${area.enabled ? "§aEnabled" : "§cDisabled"}§r\n${coords(area)}\nPriority: ${area.priority}\nCombat drop: ${area.dropItemsIfInCombat ? "On" : "Off"}`)
      .button("Basics / Rank Filter", ICONS.edit)
      .button("Messages", ICONS.menu)
      .button("Permissions", ICONS.settings)
      .button("Commands", ICONS.binding)
      .button("Effects", ICONS.utility)
      .button("Ticking Area", ICONS.sidebar)
      .button("Apply Ticking Area", ICONS.confirm)
      .button("Delete", ICONS.delete)
      .button("Back", ICONS.back);
    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 0) await editBasics(player, area.id);
    else if (response.selection === 1) await editMessages(player, area.id);
    else if (response.selection === 2) await editPermissions(player, area.id);
    else if (response.selection === 3) await listEditors(
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
    else if (response.selection === 4) await listEditors(
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
    else if (response.selection === 5) await editTickingArea(player, area.id);
    else if (response.selection === 6) tell(player, applyAreaTickingArea(area).message);
    else if (response.selection === 7) { delete state.customAreas.areas[area.id]; saveCustomAreas(); invalidateCustomAreaRuntimeState(area.id); tell(player, "Area deleted."); return; }
    else return;
  }
}

async function globalSettings(player: Player): Promise<void> {
  const cfg = state.customAreas.config;
  const modal = new ModalFormData()
    .title("Custom Area Settings")
    .toggle("Enabled", { defaultValue: cfg.enabled })
    .textField("Check interval ticks", "10", { defaultValue: String(cfg.checkIntervalTicks) })
    .textField("Max areas", "250", { defaultValue: String(cfg.maxAreas) })
    .textField("Max commands per area", "10", { defaultValue: String(cfg.maxCommandsPerArea) })
    .submitButton("Save");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  cfg.enabled = Boolean(result.formValues[0]);
  cfg.checkIntervalTicks = Math.max(1, Math.floor(Number(result.formValues[1] ?? 10)));
  cfg.maxAreas = Math.max(1, Math.floor(Number(result.formValues[2] ?? 250)));
  cfg.maxCommandsPerArea = Math.max(1, Math.floor(Number(result.formValues[3] ?? 10)));
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
    const form = new ActionFormData()
      .title("Custom Areas")
      .body(`Enabled: ${state.customAreas.config.enabled ? "Yes" : "No"}\nAreas: ${areas.length}`)
      .button("Global Settings", ICONS.settings)
      .button("Create Area", ICONS.confirm);
    for (const area of areas) form.button(`${area.enabled ? "§aON" : "§cOFF"}§r ${area.name} §7(${area.id})`, ICONS.sidebar);
    form.button("Back", ICONS.back);
    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 0) { await globalSettings(player); continue; }
    if (response.selection === 1) { await createArea(player); continue; }
    const area = areas[response.selection - 2];
    if (!area) return;
    await editArea(player, area.id);
  }
}
