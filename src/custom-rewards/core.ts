import { Player } from "@minecraft/server";
import { commandStripSlash, getScore, hasPermission, isFeatureEnabled, isOperator, normalizeKey, saveCustomRewards, setScore, state, tell } from "../storage";
import { deserializeItemStack } from "../shared/item-serialization";
import { renderTemplate } from "../shared/templates";
import { type CustomRewardAction, type CustomRewardDefinition } from "../types";

type RunRewardOptions = {
  internal?: boolean;
  extra?: Record<string, string | number | boolean | undefined>;
};

export type RewardRunResult = {
  ok: boolean;
  message: string;
};

export function normalizeRewardId(value: string): string {
  return normalizeKey(String(value ?? "")).replace(/[^a-z0-9_:-]+/g, "_");
}

export function listCustomRewardIds(): string[] {
  return Object.keys(state.customRewards.rewards).sort((a, b) => a.localeCompare(b));
}

export function getCustomReward(id: string): CustomRewardDefinition | undefined {
  return state.customRewards.rewards[normalizeRewardId(id)];
}

export function createCustomReward(id: string, name: string, description = ""): RewardRunResult {
  const normalized = normalizeRewardId(id);
  if (!normalized) return { ok: false, message: "Reward id is required." };
  if (state.customRewards.rewards[normalized]) return { ok: false, message: `Reward "${normalized}" already exists.` };
  if (Object.keys(state.customRewards.rewards).length >= state.customRewards.config.maxRewards) {
    return { ok: false, message: `Reward limit reached (${state.customRewards.config.maxRewards}).` };
  }

  state.customRewards.rewards[normalized] = {
    id: normalized,
    name: String(name ?? "").trim() || normalized,
    description: String(description ?? "").trim() || undefined,
    enabled: true,
    operatorOnly: true,
    actions: [],
  };
  saveCustomRewards();
  return { ok: true, message: `Created reward ${normalized}.` };
}

export function deleteCustomReward(id: string): boolean {
  const normalized = normalizeRewardId(id);
  if (!state.customRewards.rewards[normalized]) return false;
  delete state.customRewards.rewards[normalized];
  saveCustomRewards();
  return true;
}

function renderRewardText(raw: string, player: Player, extra: RunRewardOptions["extra"]): string {
  return renderTemplate(raw, { player, extra });
}

function canRunReward(player: Player, reward: CustomRewardDefinition, options: RunRewardOptions): boolean {
  if (options.internal) return true;
  if (reward.operatorOnly && !isOperator(player)) return false;
  const permission = String(reward.permission ?? "").trim();
  return !permission || hasPermission(player, permission) || isOperator(player);
}

function runAction(player: Player, action: CustomRewardAction, options: RunRewardOptions): void {
  if (action.type === "message") {
    tell(player, renderRewardText(action.message, player, options.extra));
    return;
  }

  if (action.type === "score") {
    const objective = String(action.objective ?? "").trim();
    if (!objective) return;
    const current = getScore(player, objective) ?? 0;
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

  if (action.type === "item") {
    const itemId = String(action.itemId ?? "").trim();
    const amount = Math.max(1, Math.min(64, Math.floor(Number(action.amount) || 1)));
    if (!itemId) return;
    try {
      player.runCommand(`give @s ${itemId} ${amount}`);
    } catch {
    }
    return;
  }

  if (action.type === "item_stack") {
    try {
      const stack = deserializeItemStack(action.item);
      const inventory = player.getComponent("minecraft:inventory")?.container;
      if (!inventory || inventory.addItem(stack)) player.dimension.spawnItem(stack, player.location);
    } catch {
    }
    return;
  }

  if (action.type === "command") {
    const command = renderRewardText(action.command, player, options.extra).trim();
    if (!command) return;
    try {
      if (action.runAs === "world") player.dimension.runCommand(commandStripSlash(command));
      else player.runCommand(commandStripSlash(command));
    } catch {
    }
  }
}

export function runCustomReward(player: Player, id: string, options: RunRewardOptions = {}): RewardRunResult {
  if (!isFeatureEnabled("customRewards") || !state.customRewards.config.enabled) return { ok: false, message: "Custom rewards are disabled." };
  const reward = getCustomReward(id);
  if (!reward) return { ok: false, message: `Reward "${id}" not found.` };
  if (!reward.enabled) return { ok: false, message: `Reward "${reward.id}" is disabled.` };
  if (!canRunReward(player, reward, options)) return { ok: false, message: "You do not have permission to run this reward." };

  for (const action of reward.actions.slice(0, state.customRewards.config.maxActionsPerReward)) runAction(player, action, options);
  return { ok: true, message: `Ran reward ${reward.id}.` };
}
