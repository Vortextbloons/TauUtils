import { Player } from "@minecraft/server";
import { createBuiltCommand, deleteBuiltCommand, getBuiltCommand, listBuiltCommandIds, runBuiltCommand } from "../command-builder";
import { isFeatureEnabled, isOperator, normalizeKey, saveCommandBuilder, state, tell } from "../storage";
import { type BuiltCommandAction, type BuiltCommandCondition, ICONS } from "../types";
import { TauUi } from "./tau-ui";

type ScoreOperator = Extract<BuiltCommandCondition, { type: "score" }>["operator"];

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function conditionSummary(condition: BuiltCommandCondition): string {
  if (condition.type === "rank") return `Rank ${condition.mode}: ${condition.ranks.join(", ") || "none"}`;
  if (condition.type === "tag") return `Tag ${condition.mode}: ${condition.tag}`;
  if (condition.type === "score") return `Score ${condition.objective} ${condition.operator} ${condition.value}`;
  return `Permission: ${condition.permission}`;
}

function actionSummary(action: BuiltCommandAction): string {
  const delay = action.delayTicks ? ` after ${action.delayTicks}t` : "";
  if (action.type === "command") return `Command${delay}: ${action.command}`;
  if (action.type === "effect") return `Effect${delay}: ${action.effectId} ${action.durationSeconds}s amp ${action.amplifier}`;
  if (action.type === "score") return `Score${delay}: ${action.operation} ${action.amount} ${action.objective}`;
  if (action.type === "tag") return `Tag${delay}: ${action.operation} ${action.tag}`;
  return `Message${delay}: ${action.message}`;
}

async function addCondition(player: Player, commandId: string, type: string): Promise<void> {
  const command = getBuiltCommand(commandId);
  if (!command) return;

  if (type === "rank") {
    const result = await TauUi.modal("Add Rank Condition")
      .dropdown("mode", "Mode", ["allow", "deny"], 0)
      .text("ranks", "Rank IDs (comma-separated)", { placeholder: "admin,owner" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    command.conditions.push({ type: "rank", mode: result.values.mode === 1 ? "deny" : "allow", ranks: parseList(result.values.ranks) });
  } else if (type === "tag") {
    const result = await TauUi.modal("Add Tag Condition")
      .dropdown("mode", "Mode", ["has", "missing"], 0)
      .text("tag", "Tag", { placeholder: "staff" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const tag = String(result.values.tag ?? "").trim();
    if (!tag) return;
    command.conditions.push({ type: "tag", mode: result.values.mode === 1 ? "missing" : "has", tag });
  } else if (type === "score") {
    const operators: ScoreOperator[] = ["==", "!=", ">=", "<=", ">", "<"];
    const result = await TauUi.modal("Add Score Condition")
      .text("objective", "Objective", { placeholder: "money" })
      .dropdown("operator", "Operator", operators, 2)
      .text("value", "Value", { placeholder: "100" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const objective = String(result.values.objective ?? "").trim();
    if (!objective) return;
    command.conditions.push({ type: "score", objective, operator: operators[Number(result.values.operator ?? 2)] ?? ">=", value: Math.floor(asNumber(result.values.value)) });
  } else if (type === "permission") {
    const result = await TauUi.modal("Add Permission Condition")
      .text("permission", "Permission", { placeholder: "tau.admin" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const permission = String(result.values.permission ?? "").trim();
    if (!permission) return;
    command.conditions.push({ type: "permission", permission });
  }

  saveCommandBuilder();
}

async function showConditionsMenu(player: Player, commandId: string): Promise<void> {
  while (true) {
    const command = getBuiltCommand(commandId);
    if (!command) return;
    const response = await TauUi.action("Command Conditions")
      .body(command.conditions.length > 0 ? command.conditions.map((entry, index) => `${index + 1}. ${conditionSummary(entry)}`).join("\n") : "No conditions. All operators/internal command areas can run it.")
      .button("rank", "Add Rank Condition", { iconPath: ICONS.rank })
      .button("score", "Add Score Condition", { iconPath: ICONS.settings })
      .button("tag", "Add Tag Condition", { iconPath: ICONS.utility })
      .button("permission", "Add Permission Condition", { iconPath: ICONS.settings })
      .button("delete", "Delete Condition", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "delete") {
      if (command.conditions.length === 0) continue;
      const picker = TauUi.action("Delete Condition");
      command.conditions.forEach((entry, index) => picker.button(String(index), conditionSummary(entry), { iconPath: ICONS.delete }));
      picker.button("back", "Back", { iconPath: ICONS.back });
      const picked = await picker.show(player);
      if (TauUi.isCanceledOrBack(picked)) continue;
      command.conditions.splice(Number(picked.id), 1);
      saveCommandBuilder();
      continue;
    }
    await addCondition(player, commandId, response.id as string);
  }
}

async function addAction(player: Player, commandId: string, type: string): Promise<void> {
  const command = getBuiltCommand(commandId);
  if (!command) return;
  if (command.actions.length >= state.commandBuilder.config.maxActionsPerCommand) {
    tell(player, `Action limit reached (${state.commandBuilder.config.maxActionsPerCommand}).`);
    return;
  }

  let action: BuiltCommandAction | undefined;
  if (type === "command") {
    const result = await TauUi.modal("Add Command Action")
      .text("command", "Command", { placeholder: "effect @s speed 60 1" })
      .text("delay", "Delay ticks before this action", { placeholder: "0" })
      .dropdown("runAs", "Run As", ["executor", "world"], 0)
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const raw = String(result.values.command ?? "").trim();
    if (!raw) return;
    action = { type: "command", command: raw, delayTicks: Math.max(0, Math.floor(asNumber(result.values.delay))), runAs: result.values.runAs === 1 ? "world" : "executor" };
  } else if (type === "effect") {
    const result = await TauUi.modal("Add Effect Action")
      .text("effectId", "Effect ID", { placeholder: "speed" })
      .text("duration", "Duration seconds", { placeholder: "60" })
      .text("amplifier", "Amplifier", { placeholder: "1" })
      .toggle("showParticles", "Show particles", false)
      .text("delay", "Delay ticks before this action", { placeholder: "0" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const effectId = String(result.values.effectId ?? "").trim();
    if (!effectId) return;
    action = { type: "effect", effectId, durationSeconds: Math.max(1, Math.floor(asNumber(result.values.duration, 1))), amplifier: Math.max(0, Math.floor(asNumber(result.values.amplifier))), showParticles: result.values.showParticles === true, delayTicks: Math.max(0, Math.floor(asNumber(result.values.delay))) };
  } else if (type === "score") {
    const result = await TauUi.modal("Add Score Action")
      .text("objective", "Objective", { placeholder: "money" })
      .dropdown("operation", "Operation", ["add", "set", "remove"], 0)
      .text("amount", "Amount", { placeholder: "100" })
      .text("delay", "Delay ticks before this action", { placeholder: "0" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const objective = String(result.values.objective ?? "").trim();
    if (!objective) return;
    const operations = ["add", "set", "remove"] as const;
    action = { type: "score", objective, operation: operations[Number(result.values.operation ?? 0)] ?? "add", amount: Math.floor(asNumber(result.values.amount)), delayTicks: Math.max(0, Math.floor(asNumber(result.values.delay))) };
  } else if (type === "tag") {
    const result = await TauUi.modal("Add Tag Action")
      .dropdown("operation", "Operation", ["add", "remove"], 0)
      .text("tag", "Tag", { placeholder: "buffed" })
      .text("delay", "Delay ticks before this action", { placeholder: "0" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const tag = String(result.values.tag ?? "").trim();
    if (!tag) return;
    action = { type: "tag", operation: result.values.operation === 1 ? "remove" : "add", tag, delayTicks: Math.max(0, Math.floor(asNumber(result.values.delay))) };
  } else if (type === "message") {
    const result = await TauUi.modal("Add Message Action")
      .text("message", "Message", { placeholder: "§aDone, [name]!" })
      .text("delay", "Delay ticks before this action", { placeholder: "0" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const message = String(result.values.message ?? "").trim();
    if (!message) return;
    action = { type: "message", message, delayTicks: Math.max(0, Math.floor(asNumber(result.values.delay))) };
  }

  if (!action) return;
  command.actions.push(action);
  saveCommandBuilder();
}

async function showActionsMenu(player: Player, commandId: string): Promise<void> {
  while (true) {
    const command = getBuiltCommand(commandId);
    if (!command) return;
    const response = await TauUi.action("Command Actions")
      .body(command.actions.length > 0 ? command.actions.map((entry, index) => `${index + 1}. ${actionSummary(entry)}`).join("\n") : "No actions yet.")
      .button("command", "Add Command Action", { iconPath: ICONS.settings })
      .button("effect", "Add Effect Action", { iconPath: ICONS.utility })
      .button("score", "Add Score Action", { iconPath: ICONS.shop })
      .button("tag", "Add Tag Action", { iconPath: ICONS.binding })
      .button("message", "Add Message Action", { iconPath: ICONS.menu })
      .button("moveUp", "Move Action Up", { iconPath: ICONS.edit })
      .button("moveDown", "Move Action Down", { iconPath: ICONS.edit })
      .button("delete", "Delete Action", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (["command", "effect", "score", "tag", "message"].includes(response.id as string)) {
      await addAction(player, commandId, response.id as string);
      continue;
    }
    if (command.actions.length === 0) continue;
    const picker = TauUi.action(response.id === "delete" ? "Delete Action" : "Move Action");
    command.actions.forEach((entry, index) => picker.button(String(index), actionSummary(entry), { iconPath: response.id === "delete" ? ICONS.delete : ICONS.edit }));
    picker.button("back", "Back", { iconPath: ICONS.back });
    const picked = await picker.show(player);
    if (TauUi.isCanceledOrBack(picked)) continue;
    const index = Number(picked.id);
    if (!Number.isInteger(index) || !command.actions[index]) continue;
    if (response.id === "delete") command.actions.splice(index, 1);
    if (response.id === "moveUp" && index > 0) [command.actions[index - 1], command.actions[index]] = [command.actions[index], command.actions[index - 1]];
    if (response.id === "moveDown" && index < command.actions.length - 1) [command.actions[index + 1], command.actions[index]] = [command.actions[index], command.actions[index + 1]];
    saveCommandBuilder();
  }
}

async function showBasicSettings(player: Player, commandId: string): Promise<void> {
  const command = getBuiltCommand(commandId);
  if (!command) return;
  const result = await TauUi.modal("Command Settings")
    .text("name", "Name", { defaultValue: command.name })
    .text("description", "Description", { defaultValue: command.description ?? "" })
    .toggle("enabled", "Enabled", command.enabled)
    .text("cooldown", "Cooldown seconds", { defaultValue: String(command.cooldownSeconds ?? 0) })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  command.name = String(result.values.name ?? "").trim() || command.name;
  command.description = String(result.values.description ?? "").trim() || undefined;
  command.enabled = result.values.enabled === true;
  command.cooldownSeconds = Math.max(0, Math.floor(asNumber(result.values.cooldown)));
  command.adminOnly = true;
  saveCommandBuilder();
}

async function showCommandEditor(player: Player, commandId: string): Promise<void> {
  while (true) {
    const command = getBuiltCommand(commandId);
    if (!command) return;
    const response = await TauUi.action(`Command: ${command.id}`)
      .body([`Name: ${command.name}`, `Enabled: ${command.enabled ? "Yes" : "No"}`, `Conditions: ${command.conditions.length}`, `Actions: ${command.actions.length}`, `Run: /tau:cmd ${command.id}`].join("\n"))
      .button("settings", "Basic Settings", { iconPath: ICONS.settings })
      .button("conditions", "Conditions", { iconPath: ICONS.rank })
      .button("actions", "Actions", { iconPath: ICONS.edit })
      .button("test", "Test Run", { iconPath: ICONS.utility })
      .button("delete", "Delete", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "settings") await showBasicSettings(player, command.id);
    if (response.id === "conditions") await showConditionsMenu(player, command.id);
    if (response.id === "actions") await showActionsMenu(player, command.id);
    if (response.id === "test") {
      const result = runBuiltCommand(player, command.id);
      tell(player, result.message);
    }
    if (response.id === "delete") {
      const confirmed = await TauUi.confirm(player, { title: "Delete Command", body: `Delete ${command.id}?`, confirmText: "Delete", cancelText: "Cancel" });
      if (!confirmed) continue;
      deleteBuiltCommand(command.id);
      return;
    }
  }
}

async function createCommandFlow(player: Player): Promise<void> {
  const result = await TauUi.modal("Create Command")
    .text("id", "Command ID", { placeholder: "buffs" })
    .text("name", "Name", { placeholder: "Buffs" })
    .text("description", "Description", { placeholder: "Gives admin buffs" })
    .submitButton("Create")
    .show(player);
  if (result.canceled) return;
  const id = normalizeKey(String(result.values.id ?? "").trim());
  const created = createBuiltCommand(id, String(result.values.name ?? "").trim(), String(result.values.description ?? "").trim());
  tell(player, created.message);
  if (created.ok && created.command) await showCommandEditor(player, created.command.id);
}

async function showSettings(player: Player): Promise<void> {
  const config = state.commandBuilder.config;
  const result = await TauUi.modal("Command Builder Settings")
    .toggle("enabled", "Enabled", config.enabled)
    .text("maxCommands", "Max commands", { defaultValue: String(config.maxCommands) })
    .text("maxActions", "Max actions per command", { defaultValue: String(config.maxActionsPerCommand) })
    .text("maxDelay", "Max delay ticks", { defaultValue: String(config.maxDelayTicks) })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  config.enabled = result.values.enabled === true;
  config.maxCommands = Math.max(1, Math.floor(asNumber(result.values.maxCommands, config.maxCommands)));
  config.maxActionsPerCommand = Math.max(1, Math.floor(asNumber(result.values.maxActions, config.maxActionsPerCommand)));
  config.maxDelayTicks = Math.max(0, Math.floor(asNumber(result.values.maxDelay, config.maxDelayTicks)));
  saveCommandBuilder();
}

export async function showCommandBuilderMenu(player: Player): Promise<void> {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to use Command Builder.");
    return;
  }
  if (!isFeatureEnabled("commandBuilder")) {
    tell(player, "Command Builder is disabled.");
    return;
  }

  while (true) {
    const ids = listBuiltCommandIds();
    const response = await TauUi.action("Command Builder")
      .body(`Commands: ${ids.length}\nRun with: /tau:cmd <id>`)
      .button("create", "Create Command", { iconPath: ICONS.edit })
      .button("edit", "Edit Command", { iconPath: ICONS.settings })
      .button("settings", "Settings", { iconPath: ICONS.settings })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "create") {
      await createCommandFlow(player);
      continue;
    }
    if (response.id === "settings") {
      await showSettings(player);
      continue;
    }
    if (response.id === "edit") {
      if (ids.length === 0) {
        tell(player, "No commands created yet.");
        continue;
      }
      const picker = TauUi.action("Edit Command");
      for (const id of ids) picker.button(id, `${id} - ${state.commandBuilder.commands[id].name}`, { iconPath: ICONS.edit });
      picker.button("back", "Back", { iconPath: ICONS.back });
      const picked = await picker.show(player);
      if (TauUi.isCanceledOrBack(picked)) continue;
      await showCommandEditor(player, picked.id as string);
    }
  }
}
