import { Player } from "@minecraft/server";
import { createCustomReward, deleteCustomReward, getCustomReward, listCustomRewardIds, runCustomReward } from "../custom-rewards";
import { isFeatureEnabled, isOperator, saveCustomRewards, state, tell } from "../storage";
import { serializeItemStack } from "../shared/item-serialization";
import { type CustomRewardAction, ICONS } from "../types";
import { TauUi } from "./tau-ui";

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function actionSummary(action: CustomRewardAction): string {
  if (action.type === "score") return `Score: ${action.operation} ${action.amount} ${action.objective}`;
  if (action.type === "item") return `Item: ${action.itemId} x${action.amount}`;
  if (action.type === "item_stack") return `Held Item: ${action.item.itemId} x${action.item.amount}`;
  if (action.type === "command") return `Command: ${action.command}`;
  if (action.type === "tag") return `Tag: ${action.operation} ${action.tag}`;
  if (action.type === "effect") return `Effect: ${action.effectId} ${action.durationSeconds}s amp ${action.amplifier}`;
  return `Message: ${action.message}`;
}

async function addRewardAction(player: Player, rewardId: string, type: string): Promise<void> {
  const reward = getCustomReward(rewardId);
  if (!reward) return;
  if (reward.actions.length >= state.customRewards.config.maxActionsPerReward) {
    tell(player, `Action limit reached (${state.customRewards.config.maxActionsPerReward}).`);
    return;
  }

  let action: CustomRewardAction | undefined;
  if (type === "score") {
    const operations = ["add", "set", "remove"] as const;
    const result = await TauUi.modal("Add Score Reward")
      .text("objective", "Objective", { placeholder: "money" })
      .dropdown("operation", "Operation", operations, 0)
      .text("amount", "Amount", { placeholder: "100" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const objective = String(result.values.objective ?? "").trim();
    if (!objective) return;
    action = { type: "score", objective, operation: operations[Number(result.values.operation ?? 0)] ?? "add", amount: Math.floor(asNumber(result.values.amount)) };
  } else if (type === "item") {
    const result = await TauUi.modal("Add Item Reward")
      .text("itemId", "Item ID", { placeholder: "minecraft:diamond" })
      .text("amount", "Amount", { placeholder: "1" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const itemId = String(result.values.itemId ?? "").trim();
    if (!itemId) return;
    action = { type: "item", itemId, amount: Math.max(1, Math.floor(asNumber(result.values.amount, 1))) };
  } else if (type === "heldItem") {
    const inventory = player.getComponent("minecraft:inventory")?.container;
    const held = inventory?.getItem(player.selectedSlotIndex);
    if (!held) {
      tell(player, "Hold an item first.");
      return;
    }
    action = { type: "item_stack", item: serializeItemStack(held) };
  } else if (type === "command") {
    const result = await TauUi.modal("Add Command Reward")
      .text("command", "Command", { placeholder: "give @s diamond 1" })
      .dropdown("runAs", "Run As", ["player", "world"], 0)
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const command = String(result.values.command ?? "").trim();
    if (!command) return;
    action = { type: "command", command, runAs: result.values.runAs === 1 ? "world" : "player" };
  } else if (type === "tag") {
    const result = await TauUi.modal("Add Tag Reward")
      .dropdown("operation", "Operation", ["add", "remove"], 0)
      .text("tag", "Tag", { placeholder: "referred" })
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const tag = String(result.values.tag ?? "").trim();
    if (!tag) return;
    action = { type: "tag", operation: result.values.operation === 1 ? "remove" : "add", tag };
  } else if (type === "effect") {
    const result = await TauUi.modal("Add Effect Reward")
      .text("effectId", "Effect ID", { placeholder: "speed" })
      .text("duration", "Duration seconds", { placeholder: "60" })
      .text("amplifier", "Amplifier", { placeholder: "0" })
      .toggle("showParticles", "Show particles", false)
      .submitButton("Add")
      .show(player);
    if (result.canceled) return;
    const effectId = String(result.values.effectId ?? "").trim();
    if (!effectId) return;
    action = { type: "effect", effectId, durationSeconds: Math.max(1, Math.floor(asNumber(result.values.duration, 60))), amplifier: Math.max(0, Math.floor(asNumber(result.values.amplifier))), showParticles: result.values.showParticles === true };
  } else if (type === "message") {
    const result = await TauUi.modal("Add Message Reward").text("message", "Message", { placeholder: "§aReward received!" }).submitButton("Add").show(player);
    if (result.canceled) return;
    const message = String(result.values.message ?? "").trim();
    if (!message) return;
    action = { type: "message", message };
  }

  if (!action) return;
  reward.actions.push(action);
  saveCustomRewards();
}

async function showRewardEditor(player: Player, rewardId: string): Promise<void> {
  while (true) {
    const reward = getCustomReward(rewardId);
    if (!reward) return;
    const response = await TauUi.action("Edit Reward")
      .body(`${reward.name}\nEnabled: ${reward.enabled ? "On" : "Off"}\nOperator only: ${reward.operatorOnly ? "Yes" : "No"}\nPermission: ${reward.permission || "none"}\nActions:\n${reward.actions.map((action, index) => `${index + 1}. ${actionSummary(action)}`).join("\n") || "none"}`)
      .button("settings", "Settings", { iconPath: ICONS.settings })
      .button("score", "Add Score", { iconPath: ICONS.shop })
      .button("item", "Add Item", { iconPath: ICONS.item })
      .button("heldItem", "Add Held Item", { iconPath: ICONS.item })
      .button("command", "Add Command", { iconPath: ICONS.utility })
      .button("tag", "Add Tag", { iconPath: ICONS.binding })
      .button("effect", "Add Effect", { iconPath: ICONS.utility })
      .button("message", "Add Message", { iconPath: ICONS.menu })
      .button("deleteAction", "Delete Action", { iconPath: ICONS.delete })
      .button("test", "Test On Me", { iconPath: ICONS.confirm })
      .button("delete", "Delete Reward", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (["score", "item", "heldItem", "command", "tag", "effect", "message"].includes(response.id as string)) {
      await addRewardAction(player, rewardId, response.id as string);
      continue;
    }
    if (response.id === "settings") {
      const result = await TauUi.modal("Reward Settings")
        .text("name", "Name", { defaultValue: reward.name })
        .text("description", "Description", { defaultValue: reward.description ?? "" })
        .toggle("enabled", "Enabled", reward.enabled)
        .toggle("operatorOnly", "Operator only", reward.operatorOnly)
        .text("permission", "Permission (blank none)", { placeholder: "tau.reward.vip", defaultValue: reward.permission ?? "" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      reward.name = String(result.values.name ?? "").trim() || reward.id;
      reward.description = String(result.values.description ?? "").trim() || undefined;
      reward.enabled = result.values.enabled === true;
      reward.operatorOnly = result.values.operatorOnly === true;
      reward.permission = String(result.values.permission ?? "").trim() || undefined;
      saveCustomRewards();
      continue;
    }
    if (response.id === "deleteAction") {
      if (reward.actions.length === 0) continue;
      const picker = TauUi.action("Delete Action");
      reward.actions.forEach((action, index) => picker.button(String(index), actionSummary(action), { iconPath: ICONS.delete }));
      picker.button("back", "Back", { iconPath: ICONS.back });
      const picked = await picker.show(player);
      if (TauUi.isCanceledOrBack(picked)) continue;
      reward.actions.splice(Number(picked.id), 1);
      saveCustomRewards();
      continue;
    }
    if (response.id === "test") {
      tell(player, runCustomReward(player, reward.id, { internal: true }).message);
      continue;
    }
    if (response.id === "delete") {
      deleteCustomReward(reward.id);
      tell(player, "Reward deleted.");
      return;
    }
  }
}

export async function showCustomRewardsAdminMenu(player: Player): Promise<void> {
  if (!isOperator(player)) {
    tell(player, "Operator required.");
    return;
  }
  if (!isFeatureEnabled("customRewards")) {
    tell(player, "Custom rewards are disabled.");
    return;
  }
  while (true) {
    const ids = listCustomRewardIds();
    const response = await TauUi.action("Custom Rewards")
      .body(`Rewards: ${ids.length}\nSystem: ${state.customRewards.config.enabled ? "On" : "Off"}`)
      .button("toggle", `System: ${state.customRewards.config.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("create", "Create Reward", { iconPath: ICONS.confirm })
      .button("edit", "Edit Reward", { iconPath: ICONS.edit })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "toggle") {
      state.customRewards.config.enabled = !state.customRewards.config.enabled;
      saveCustomRewards();
      continue;
    }
    if (response.id === "create") {
      const result = await TauUi.modal("Create Reward")
        .text("id", "ID", { placeholder: "daily_bonus" })
        .text("name", "Name", { placeholder: "Daily Bonus" })
        .text("description", "Description", { placeholder: "Optional" })
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      tell(player, createCustomReward(String(result.values.id ?? ""), String(result.values.name ?? ""), String(result.values.description ?? "")).message);
      continue;
    }
    if (response.id === "edit") {
      if (ids.length === 0) continue;
      const picker = TauUi.action("Pick Reward");
      for (const id of ids) picker.button(id, `${state.customRewards.rewards[id].name} (${id})`, { iconPath: ICONS.edit });
      picker.button("back", "Back", { iconPath: ICONS.back });
      const picked = await picker.show(player);
      if (TauUi.isCanceledOrBack(picked)) continue;
      await showRewardEditor(player, picked.id as string);
    }
  }
}
