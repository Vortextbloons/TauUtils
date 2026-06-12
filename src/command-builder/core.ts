import { Player, system } from "@minecraft/server";
import { commandStripSlash, getPlayerRank, getScore, hasPermission, isFeatureEnabled, isOperator, normalizeKey, saveCommandBuilder, setScore, state, tell } from "../storage";
import { renderCommandTemplate, renderTemplate } from "../shared/templates";
import { type BuiltCommandAction, type BuiltCommandCondition, type BuiltCommandDefinition } from "../types";

type RunOptions = {
  allowNonOperator?: boolean;
  depth?: number;
};

export type BuiltCommandRunResult = {
  ok: boolean;
  message: string;
};

const cooldownEndsByKey = new Map<string, number>();

export function normalizeBuiltCommandId(value: string): string {
  return normalizeKey(String(value ?? "")).replace(/[^a-z0-9_:-]+/g, "_");
}

export function listBuiltCommandIds(): string[] {
  return Object.keys(state.commandBuilder.commands).sort((a, b) => a.localeCompare(b));
}

export function getBuiltCommand(id: string): BuiltCommandDefinition | undefined {
  const normalized = normalizeBuiltCommandId(id);
  return state.commandBuilder.commands[normalized];
}

export function createBuiltCommand(id: string, name: string, description = ""): { ok: boolean; message: string; command?: BuiltCommandDefinition } {
  const normalized = normalizeBuiltCommandId(id);
  if (!normalized) return { ok: false, message: "Command id is required." };
  if (state.commandBuilder.commands[normalized]) return { ok: false, message: `Command "${normalized}" already exists.` };
  if (Object.keys(state.commandBuilder.commands).length >= state.commandBuilder.config.maxCommands) {
    return { ok: false, message: `Command limit reached (${state.commandBuilder.config.maxCommands}).` };
  }

  const command: BuiltCommandDefinition = {
    id: normalized,
    name: String(name ?? "").trim() || normalized,
    description: String(description ?? "").trim() || undefined,
    enabled: true,
    adminOnly: true,
    cooldownSeconds: 0,
    conditions: [],
    actions: [],
  };
  state.commandBuilder.commands[normalized] = command;
  saveCommandBuilder();
  return { ok: true, message: `Created command ${normalized}.`, command };
}

export function deleteBuiltCommand(id: string): boolean {
  const normalized = normalizeBuiltCommandId(id);
  if (!state.commandBuilder.commands[normalized]) return false;
  delete state.commandBuilder.commands[normalized];
  saveCommandBuilder();
  return true;
}

function cooldownKey(player: Player, commandId: string): string {
  return `${player.id || player.name}:${commandId}`;
}

function getActionDelay(action: BuiltCommandAction): number {
  return Math.max(0, Math.min(state.commandBuilder.config.maxDelayTicks, Math.floor(Number(action.delayTicks ?? 0) || 0)));
}

function compareScore(current: number, condition: Extract<BuiltCommandCondition, { type: "score" }>): boolean {
  const target = Math.floor(Number(condition.value) || 0);
  if (condition.operator === "==") return current === target;
  if (condition.operator === "!=") return current !== target;
  if (condition.operator === ">=") return current >= target;
  if (condition.operator === "<=") return current <= target;
  if (condition.operator === ">") return current > target;
  if (condition.operator === "<") return current < target;
  return false;
}

function conditionPasses(player: Player, condition: BuiltCommandCondition): boolean {
  if (condition.type === "rank") {
    const rankId = getPlayerRank(player.name)?.id.toLowerCase() ?? "";
    const ranks = new Set(condition.ranks.map((rank) => normalizeKey(rank)).filter((rank) => rank.length > 0));
    const matched = rankId.length > 0 && ranks.has(rankId);
    return condition.mode === "allow" ? matched : !matched;
  }

  if (condition.type === "tag") {
    const hasTag = condition.tag.trim().length > 0 && player.hasTag(condition.tag.trim());
    return condition.mode === "has" ? hasTag : !hasTag;
  }

  if (condition.type === "score") {
    const objective = String(condition.objective ?? "").trim();
    if (!objective) return false;
    const current = getScore(player, objective);
    if (current === undefined) return false;
    return compareScore(current, condition);
  }

  if (condition.type === "permission") {
    const permission = String(condition.permission ?? "").trim();
    return permission.length > 0 && hasPermission(player, permission);
  }

  return false;
}

function renderBuiltCommandText(raw: string, player: Player, command: BuiltCommandDefinition): string {
  const loc = player.location;
  return renderTemplate(raw, {
    player,
    extra: {
      id: command.id,
      command_id: command.id,
      x: Math.floor(loc.x),
      y: Math.floor(loc.y),
      z: Math.floor(loc.z),
      dimension: player.dimension.id,
    },
  });
}

function parseNestedBuiltCommand(command: string): string | undefined {
  const normalized = commandStripSlash(command).trim();
  const match = /^tau:cmd\s+([^\s]+)$/i.exec(normalized);
  return match?.[1];
}

function runAction(player: Player, command: BuiltCommandDefinition, action: BuiltCommandAction, options: RunOptions): void {
  if (action.type === "message") {
    tell(player, renderBuiltCommandText(action.message, player, command));
    return;
  }

  if (action.type === "score") {
    const objective = String(action.objective ?? "").trim();
    if (!objective) return;
    const current = getScore(player, objective);
    if (current === undefined) return;
    const amount = Math.floor(Number(action.amount) || 0);
    const next = action.operation === "set" ? amount : action.operation === "remove" ? current - amount : current + amount;
    setScore(player, objective, next);
    return;
  }

  if (action.type === "tag") {
    const tag = String(action.tag ?? "").trim();
    if (!tag) return;
    if (action.operation === "remove") player.removeTag(tag);
    else player.addTag(tag);
    return;
  }

  if (action.type === "effect") {
    const effectId = String(action.effectId ?? "").trim();
    if (!effectId) return;
    const seconds = Math.max(1, Math.floor(Number(action.durationSeconds) || 1));
    const amplifier = Math.max(0, Math.floor(Number(action.amplifier) || 0));
    const hideParticles = action.showParticles === false ? "true" : "false";
    try {
      player.runCommand(`effect @s ${effectId} ${seconds} ${amplifier} ${hideParticles}`);
    } catch {
    }
    return;
  }

  if (action.type === "command") {
    const rendered = renderCommandTemplate(renderBuiltCommandText(action.command, player, command));
    if (!rendered) return;
    const nestedId = parseNestedBuiltCommand(rendered);
    if (nestedId) {
      runBuiltCommand(player, nestedId, { allowNonOperator: true, depth: (options.depth ?? 0) + 1 });
      return;
    }
    try {
      if (action.runAs === "world") player.dimension.runCommand(commandStripSlash(rendered));
      else player.runCommand(commandStripSlash(rendered));
    } catch {
    }
  }
}

export function runBuiltCommand(player: Player, id: string, options: RunOptions = {}): BuiltCommandRunResult {
  if (!isFeatureEnabled("commandBuilder") || !state.commandBuilder.config.enabled) {
    return { ok: false, message: "Command Builder is disabled." };
  }
  if (!options.allowNonOperator && !isOperator(player)) {
    return { ok: false, message: "Operator required." };
  }
  if ((options.depth ?? 0) > 5) {
    return { ok: false, message: "Command Builder recursion limit reached." };
  }

  const command = getBuiltCommand(id);
  if (!command) return { ok: false, message: `Command "${id}" not found.` };
  if (!command.enabled) return { ok: false, message: `Command "${command.id}" is disabled.` };
  if (command.adminOnly === true && options.allowNonOperator && !isOperator(player)) return { ok: false, message: "Operator required." };

  for (const condition of command.conditions.slice(0, 50)) {
    if (!conditionPasses(player, condition)) return { ok: false, message: "Command conditions were not met." };
  }

  const cooldownSeconds = Math.max(0, Number(command.cooldownSeconds ?? 0) || 0);
  if (cooldownSeconds > 0) {
    const key = cooldownKey(player, command.id);
    const endsAt = cooldownEndsByKey.get(key) ?? 0;
    const remainingMs = endsAt - Date.now();
    if (remainingMs > 0) return { ok: false, message: `Command cooldown: ${(remainingMs / 1000).toFixed(1)}s.` };
    cooldownEndsByKey.set(key, Date.now() + cooldownSeconds * 1000);
  }

  const actions = command.actions.slice(0, state.commandBuilder.config.maxActionsPerCommand);
  let delay = 0;
  for (const action of actions) {
    delay += getActionDelay(action);
    if (delay <= 0) {
      runAction(player, command, action, options);
    } else {
      const scheduledAction = action;
      system.runTimeout(() => runAction(player, command, scheduledAction, options), delay);
    }
  }

  return { ok: true, message: `Ran command ${command.id}.` };
}

export function runBuiltCommandFromConfiguredCommand(player: Player, rawCommand: string): boolean {
  const id = parseNestedBuiltCommand(rawCommand);
  if (!id) return false;
  runBuiltCommand(player, id, { allowNonOperator: true });
  return true;
}
