import { Player } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS, type CrateAnimationPreset, type CrateReward } from "../../types";
import { normalizeBlockId } from "../../shared/item-id";
import { isOperator, saveCrates, state, tell } from "../../storage";
import {
  getLookedAtBlockLocation,
  giveCrateKey,
  listCrateIds,
  removeCrateAtBlock,
  removeCrateAtCoordinates,
  setCrateAtBlock,
  setCrateAtCoordinates,
  setCrateBlockIdFromLooked,
} from "../../crates";
import { getHeldItemSnapshot, heldItemToCrateReward } from "../ui-utils";

function parseCoord(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function tellCrateResult(player: Player, result: { ok: boolean; message: string }): void {
  tell(player, result.ok ? `§a${result.message}` : `§c${result.message}`);
}

async function promptCrateLocation(player: Player, title: string) {
  const looked = getLookedAtBlockLocation(player);
  const fallback = looked ?? {
    dimensionId: player.dimension.id,
    x: Math.floor(player.location.x),
    y: Math.floor(player.location.y),
    z: Math.floor(player.location.z),
  };
  const result = await TauUi.modal(title)
    .text("dimensionId", "Dimension id", { placeholder: "minecraft:overworld", defaultValue: fallback.dimensionId })
    .text("x", "X", { placeholder: "0", defaultValue: String(fallback.x) })
    .text("y", "Y", { placeholder: "0", defaultValue: String(fallback.y) })
    .text("z", "Z", { placeholder: "0", defaultValue: String(fallback.z) })
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

function getCrateRewardChanceText(reward: CrateReward, totalWeight: number): string {
  if (totalWeight <= 0) return "0%";
  const chance = (reward.weight / totalWeight) * 100;
  return `${chance.toFixed(chance >= 10 ? 1 : 2)}%`;
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
    const locationSummary = locations.length === 0
      ? ""
      : `\n§7Sites:\n${locations.slice(0, 5).map((entry) => `§8- §f${formatCrateLocation(entry)}`).join("\n")}${locations.length > 5 ? `\n§8...and ${locations.length - 5} more` : ""}`;
    const response = await TauUi.action(`§6Crate: ${crate.displayName}§r`)
      .body(`§7Block: §f${crate.crateBlockId}\n§7Key item: §f${crate.keyItemId}\n§7Key lore: §f${crate.keyLoreLine}\n§7Anim preset: §f${crate.animationPreset}\n§7Particle preset: §f${crate.particlePreset}\n§7Broadcast rare wins: §f${crate.broadcastRareWins ? "On" : "Off"}\n§7Rare threshold: §f${crate.rareBroadcastWeightThreshold}\n§7Rewards: §f${crate.rewards.length}\n§7Locations: §f${locations.length}${locationSummary}`)
      .button("rename", "Rename Display", { iconPath: ICONS.edit })
      .button("setBlock", "Set Crate Block", { iconPath: ICONS.binding })
      .button("setBlockFromLooked", "Set Block From Looked", { iconPath: ICONS.binding })
      .button("setKey", "Set Key Item", { iconPath: ICONS.binding })
      .button("setKeyLore", "Set Key Lore", { iconPath: ICONS.edit })
      .button("setAnimation", "Set Animation Preset", { iconPath: ICONS.settings })
      .button("setParticle", "Set Particle Preset", { iconPath: ICONS.settings })
      .button("toggleRare", `Rare Broadcast: ${crate.broadcastRareWins ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("setRareThreshold", "Set Rare Threshold", { iconPath: ICONS.edit })
      .button("manageRewards", "Manage Rewards", { iconPath: ICONS.shop })
      .button("registerBlock", "Register Looked Block", { iconPath: ICONS.confirm })
      .button("registerCoords", "Register Coordinates", { iconPath: ICONS.confirm })
      .button("removeBlock", "Remove Looked Block", { iconPath: ICONS.delete })
      .button("removeCoords", "Remove Coordinates", { iconPath: ICONS.delete })
      .button("giveKey", "Give Key", { iconPath: ICONS.confirm })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "back") return;

    if (response.id === "rename") {
      const result = await TauUi.modal("Rename Crate")
        .text("displayName", "Display name", { placeholder: "Legendary Crate", defaultValue: crate.displayName })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      crate.displayName = String(result.values.displayName ?? crate.displayName).trim() || crate.displayName;
      saveCrates();
      continue;
    }

    if (response.id === "setBlock") {
      const result = await TauUi.modal("Set Crate Block")
        .text("blockId", "Block id", { placeholder: "minecraft:gilded_blackstone", defaultValue: crate.crateBlockId })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const previousBlockId = crate.crateBlockId;
      crate.crateBlockId = normalizeBlockId(String(result.values.blockId ?? crate.crateBlockId).trim() || crate.crateBlockId);
      saveCrates();
      if (locations.length > 0 && crate.crateBlockId !== previousBlockId) {
        tell(player, "§eCrate block id changed. Existing world blocks must match or registrations may fail on use.");
      }
      continue;
    }

    if (response.id === "setBlockFromLooked") {
      tellCrateResult(player, setCrateBlockIdFromLooked(player, crate.id));
      continue;
    }

    if (response.id === "setKey") {
      const result = await TauUi.modal("Set Key Item")
        .text("itemId", "Item id", { placeholder: "minecraft:tripwire_hook", defaultValue: crate.keyItemId })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      crate.keyItemId = normalizeBlockId(String(result.values.itemId ?? crate.keyItemId).trim() || crate.keyItemId);
      saveCrates();
      continue;
    }

    if (response.id === "setKeyLore") {
      const result = await TauUi.modal("Set Key Lore")
        .text("loreLine", "Lore line", { placeholder: "§6Legendary Key", defaultValue: crate.keyLoreLine })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      crate.keyLoreLine = String(result.values.loreLine ?? crate.keyLoreLine).trim() || crate.keyLoreLine;
      saveCrates();
      continue;
    }

    if (response.id === "setAnimation") {
      const presets: CrateAnimationPreset[] = ["arcane", "ember", "frost", "void"];
      const result = await TauUi.modal("Set Animation Preset")
        .dropdown("preset", "Preset", presets, presets.indexOf(crate.animationPreset ?? "arcane"))
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const preset = presets[Math.max(0, Math.min(presets.length - 1, Math.floor(Number(result.values.preset ?? 0))))] ?? "arcane";
      crate.animationPreset = preset;
      saveCrates();
      continue;
    }

    if (response.id === "setParticle") {
      const presets = ["arcane", "ember", "frost", "void"];
      const result = await TauUi.modal("Set Particle Preset")
        .dropdown("preset", "Preset", presets, presets.indexOf(crate.particlePreset ?? "arcane"))
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      crate.particlePreset = (["arcane", "ember", "frost", "void"][Math.max(0, Math.min(3, Math.floor(Number(result.values.preset ?? 0))))] ?? "arcane") as any;
      saveCrates();
      continue;
    }

    if (response.id === "toggleRare") {
      crate.broadcastRareWins = !crate.broadcastRareWins;
      saveCrates();
      continue;
    }

    if (response.id === "setRareThreshold") {
      const result = await TauUi.modal("Rare Threshold")
        .text("threshold", "Weight threshold", { placeholder: "5", defaultValue: String(crate.rareBroadcastWeightThreshold) })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const threshold = Math.max(1, Math.floor(Number(result.values.threshold ?? crate.rareBroadcastWeightThreshold)));
      if (Number.isFinite(threshold)) crate.rareBroadcastWeightThreshold = threshold;
      saveCrates();
      continue;
    }

    if (response.id === "manageRewards") {
      await showCrateRewardEditor(player, crate.id);
      continue;
    }

    if (response.id === "registerBlock") {
      tellCrateResult(player, setCrateAtBlock(player, crate.id));
      continue;
    }

    if (response.id === "registerCoords") {
      const location = await promptCrateLocation(player, "Register Coordinates");
      if (!location) continue;
      tellCrateResult(player, setCrateAtCoordinates(crate.id, location.dimensionId, location.x, location.y, location.z));
      continue;
    }

    if (response.id === "removeBlock") {
      tellCrateResult(player, removeCrateAtBlock(player));
      continue;
    }

    if (response.id === "removeCoords") {
      const location = await promptCrateLocation(player, "Remove Coordinates");
      if (!location) continue;
      tellCrateResult(player, removeCrateAtCoordinates(location.dimensionId, location.x, location.y, location.z));
      continue;
    }

    if (response.id === "giveKey") {
      const result = giveCrateKey(player, crate.id, 1);
      tell(player, result.ok ? result.message : `§c${result.message}`);
      continue;
    }
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
      : crate.rewards.map((reward, index) => `§7${index + 1}. §f${reward.label} §8(${reward.type}, ${reward.weight}, ${getCrateRewardChanceText(reward as any, totalWeight)})`).join("\n");

    const response = await TauUi.action(`Rewards: ${crate.displayName}`)
      .body(`Select a reward to edit. Total rewards: ${crate.rewards.length}\n§7Total weight: §f${totalWeight}\n${rewardSummary}`)
      .button("addItem", "Add Item Reward", { iconPath: ICONS.confirm })
      .button("addScore", "Add Score Reward", { iconPath: ICONS.confirm })
      .button("addTag", "Add Tag Reward", { iconPath: ICONS.confirm })
      .button("addCommand", "Add Command Reward", { iconPath: ICONS.confirm })
      .button("edit", "Edit Reward", { iconPath: ICONS.edit })
      .button("delete", "Delete Reward", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "back") return;

    if (response.id === "addItem") {
      const result = await TauUi.modal("Add Item Reward")
        .text("label", "Label", { placeholder: "Diamond x8" })
        .text("itemId", "Item id", { placeholder: "minecraft:diamond" })
        .text("amount", "Amount", { placeholder: "8" })
        .text("weight", "Weight", { placeholder: "100" })
        .toggle("useHeld", "Use held item metadata", true)
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      const label = String(result.values.label ?? "").trim();
      const itemId = String(result.values.itemId ?? "").trim();
      const amount = Math.max(1, Math.floor(Number(result.values.amount ?? 1)));
      const weight = Math.max(1, Math.floor(Number(result.values.weight ?? 1)));
      const useHeld = Boolean(result.values.useHeld);
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

    if (response.id === "addScore") {
      const result = await TauUi.modal("Add Score Reward")
        .text("label", "Label", { placeholder: "$1000" })
        .text("objective", "Objective", { placeholder: "money" })
        .text("amount", "Amount", { placeholder: "1000" })
        .text("weight", "Weight", { placeholder: "10" })
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      crate.rewards.push({ type: "score", label: String(result.values.label ?? "").trim(), objective: String(result.values.objective ?? "").trim(), amount: Math.floor(Number(result.values.amount ?? 1)), weight: Math.max(1, Math.floor(Number(result.values.weight ?? 1))) });
      saveCrates();
      continue;
    }

    if (response.id === "addTag") {
      const result = await TauUi.modal("Add Tag Reward")
        .text("label", "Label", { placeholder: "VIP Tag" })
        .text("tag", "Tag", { placeholder: "tau.vip" })
        .text("weight", "Weight", { placeholder: "1" })
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      crate.rewards.push({ type: "tag", label: String(result.values.label ?? "").trim(), tag: String(result.values.tag ?? "").trim(), weight: Math.max(1, Math.floor(Number(result.values.weight ?? 1))) });
      saveCrates();
      continue;
    }

    if (response.id === "addCommand") {
      const result = await TauUi.modal("Add Command Reward")
        .text("label", "Label", { placeholder: "Run Command" })
        .text("command", "Command", { placeholder: "say hello" })
        .text("weight", "Weight", { placeholder: "1" })
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      crate.rewards.push({ type: "command", label: String(result.values.label ?? "").trim(), command: String(result.values.command ?? "").trim(), weight: Math.max(1, Math.floor(Number(result.values.weight ?? 1))) });
      saveCrates();
      continue;
    }

    if (response.id === "edit" || response.id === "delete") {
      if (crate.rewards.length === 0) continue;
      const isDelete = response.id === "delete";
      const pick = TauUi.action<{ index: number }>(isDelete ? "Delete Reward" : "Edit Reward").body("Select a reward.");
      for (let i = 0; i < crate.rewards.length; i++) {
        pick.button(String(i), `${crate.rewards[i].label} (${crate.rewards[i].type})`, { iconPath: isDelete ? ICONS.delete : ICONS.edit, value: { index: i } });
      }
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (TauUi.isCanceledOrBack(picked)) continue;
      if (picked.value === undefined) continue;
      if (isDelete) {
        crate.rewards.splice(picked.value.index, 1);
        saveCrates();
        continue;
      }

      const reward = crate.rewards[picked.value.index];
      if (reward.type === "item") {
        const result = await TauUi.modal("Edit Item Reward")
          .text("label", "Label", { placeholder: "Diamond x8", defaultValue: reward.label })
          .text("itemId", "Item id", { placeholder: "minecraft:diamond", defaultValue: reward.itemId })
          .text("amount", "Amount", { placeholder: "8", defaultValue: String(reward.amount) })
          .text("weight", "Weight", { placeholder: "100", defaultValue: String(reward.weight) })
          .toggle("useHeld", "Use held item metadata", false)
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        reward.label = String(result.values.label ?? reward.label).trim() || reward.label;
        reward.itemId = String(result.values.itemId ?? reward.itemId).trim() || reward.itemId;
        reward.amount = Math.max(1, Math.floor(Number(result.values.amount ?? reward.amount)));
        reward.weight = Math.max(1, Math.floor(Number(result.values.weight ?? reward.weight)));
        if (Boolean(result.values.useHeld)) {
          const heldReward = heldItemToCrateReward(player, reward.label, reward.weight, reward.amount);
          if (heldReward) {
            Object.assign(reward, heldReward);
          }
        }
        saveCrates();
        continue;
      }

      if (reward.type === "score") {
        const result = await TauUi.modal("Edit Score Reward")
          .text("label", "Label", { placeholder: "$1000", defaultValue: reward.label })
          .text("objective", "Objective", { placeholder: "money", defaultValue: reward.objective })
          .text("amount", "Amount", { placeholder: "1000", defaultValue: String(reward.amount) })
          .text("weight", "Weight", { placeholder: "10", defaultValue: String(reward.weight) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        reward.label = String(result.values.label ?? reward.label).trim() || reward.label;
        reward.objective = String(result.values.objective ?? reward.objective).trim() || reward.objective;
        reward.amount = Math.floor(Number(result.values.amount ?? reward.amount));
        reward.weight = Math.max(1, Math.floor(Number(result.values.weight ?? reward.weight)));
        saveCrates();
        continue;
      }

      if (reward.type === "tag") {
        const result = await TauUi.modal("Edit Tag Reward")
          .text("label", "Label", { placeholder: "VIP Tag", defaultValue: reward.label })
          .text("tag", "Tag", { placeholder: "tau.vip", defaultValue: reward.tag })
          .text("weight", "Weight", { placeholder: "1", defaultValue: String(reward.weight) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        reward.label = String(result.values.label ?? reward.label).trim() || reward.label;
        reward.tag = String(result.values.tag ?? reward.tag).trim() || reward.tag;
        reward.weight = Math.max(1, Math.floor(Number(result.values.weight ?? reward.weight)));
        saveCrates();
        continue;
      }

      if (reward.type === "command") {
        const result = await TauUi.modal("Edit Command Reward")
          .text("label", "Label", { placeholder: "Run Command", defaultValue: reward.label })
          .text("command", "Command", { placeholder: "say hello", defaultValue: reward.command })
          .text("weight", "Weight", { placeholder: "1", defaultValue: String(reward.weight) })
          .submitButton("Save")
          .show(player);
        if (result.canceled) continue;
        reward.label = String(result.values.label ?? reward.label).trim() || reward.label;
        reward.command = String(result.values.command ?? reward.command).trim() || reward.command;
        reward.weight = Math.max(1, Math.floor(Number(result.values.weight ?? reward.weight)));
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
    const response = await TauUi.action("§6Crate Admin§r")
      .body(`§7Manage crate blocks, keys, and rewards.\n§7Enabled: §f${state.crates.config.enabled ? "On" : "Off"}§7 | Crates: §f${validCrateIds.length}§7 | Locations: §f${Object.keys(state.crates.locations).length}`)
      .button("create", "Create Crate", { iconPath: ICONS.confirm })
      .button("edit", "Edit Crate", { iconPath: ICONS.edit })
      .button("delete", "Delete Crate", { iconPath: ICONS.delete })
      .button("toggleEnabled", `Crates Enabled: ${state.crates.config.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "back") return;

    if (response.id === "create") {
      const result = await TauUi.modal("Create Crate")
        .text("id", "Id", { placeholder: "legendary" })
        .text("displayName", "Display name", { placeholder: "Legendary Crate" })
        .text("blockId", "Block id", { placeholder: "minecraft:gilded_blackstone" })
        .toggle("useHeldKey", "Use held item as key item", true)
        .toggle("useHeldLore", "Use held item lore", true)
        .text("keyItemId", "Key item id", { placeholder: "minecraft:tripwire_hook" })
        .text("keyLore", "Key lore", { placeholder: "§6Legendary Key" })
        .dropdown("animationPreset", "Animation preset", ["arcane", "ember", "frost", "void"], 0)
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      const id = String(result.values.id ?? "").trim().toLowerCase();
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
        displayName: String(result.values.displayName ?? "Crate").trim() || "Crate",
        crateBlockId: normalizeBlockId(String(result.values.blockId ?? "minecraft:gilded_blackstone").trim() || "minecraft:gilded_blackstone"),
        keyItemId: normalizeBlockId(String(result.values.keyItemId ?? "minecraft:tripwire_hook").trim() || "minecraft:tripwire_hook"),
        keyLoreLine: String(result.values.keyLore ?? "§6Key").trim() || "§6Key",
        animationPreset: (["arcane", "ember", "frost", "void"][Math.max(0, Math.min(3, Math.floor(Number(result.values.animationPreset ?? 0))))] ?? "arcane") as CrateAnimationPreset,
        particlePreset: "arcane",
        broadcastRareWins: true,
        rareBroadcastWeightThreshold: 5,
        rewards: [],
      };
      if (Boolean(result.values.useHeldKey)) {
        const held = getHeldItemSnapshot(player);
        if (held) {
          state.crates.crates[id].keyItemId = normalizeBlockId(held.itemId);
          if (Boolean(result.values.useHeldLore) && held.lore && held.lore.length > 0) state.crates.crates[id].keyLoreLine = held.lore[0] ?? state.crates.crates[id].keyLoreLine;
        }
      }
      saveCrates();
      continue;
    }

    if (response.id === "edit") {
      if (crateIds.length === 0) {
        tell(player, "No crates available.");
        continue;
      }
      const pick = TauUi.action<{ crateId: string }>("Edit Crate").body("Select a crate.");
      for (const id of validCrateIds) pick.button(id, state.crates.crates[id].displayName, { iconPath: ICONS.edit, value: { crateId: id } });
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (TauUi.isCanceledOrBack(picked)) continue;
      if (picked.value === undefined) continue;
      await showCrateEditor(player, picked.value.crateId);
      continue;
    }

    if (response.id === "delete") {
      if (crateIds.length === 0) {
        tell(player, "No crates available.");
        continue;
      }
      const pick = TauUi.action<{ crateId: string }>("Delete Crate").body("Select a crate to delete.");
      for (const id of validCrateIds) pick.button(id, state.crates.crates[id].displayName, { iconPath: ICONS.delete, value: { crateId: id } });
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (TauUi.isCanceledOrBack(picked)) continue;
      if (picked.value === undefined) continue;
      const targetId = picked.value.crateId;
      delete state.crates.crates[targetId];
      for (const [key, entry] of Object.entries(state.crates.locations)) {
        if (entry.crateId === targetId) delete state.crates.locations[key];
      }
      saveCrates();
      continue;
    }

    if (response.id === "toggleEnabled") {
      state.crates.config.enabled = !state.crates.config.enabled;
      saveCrates();
      continue;
    }
  }
}
