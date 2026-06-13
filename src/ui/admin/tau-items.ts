import { Player } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS, type TauItemTriggerType, type TauItemConsumptionMode, type TauItemAction, type TauItemDefinition } from "../../types";
import { isOperator, saveTauItems, state, tell } from "../../storage";
import { createTauItemDefinition, deleteTauItemDefinition, getTauItemDefinition, giveTauItem, listTauItemIds, updateTauItemDefinition } from "../../tau-items";

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
  if (TauUi.isCanceledOrBack(response)) return undefined;

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
    if (TauUi.isCanceledOrBack(response)) return;
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
      if (TauUi.isCanceledOrBack(picked)) continue;
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
    if (TauUi.isCanceledOrBack(response)) return;
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
    if (TauUi.isCanceledOrBack(response)) return;
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
    if (TauUi.isCanceledOrBack(response)) return;
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
      if (TauUi.isCanceledOrBack(picked)) continue;
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
      if (TauUi.isCanceledOrBack(picked)) continue;
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
