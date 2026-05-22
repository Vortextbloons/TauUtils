import { Player } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS } from "../../types";
import { isFeatureEnabled, isOperator, normalizeKey, saveBinds, saveConfig, savePrune, state, tell } from "../../storage";
import { pruneData, tellPruneResult } from "../../prune";

export async function showBindingsEditor(player: Player) {
  if (!isFeatureEnabled("bindings")) {
    tell(player, "Bindings are disabled.");
    return;
  }
  while (true) {
    const response = await TauUi.action("Bindings")
      .button("setItemBind", "Set item bind", { iconPath: ICONS.binding })
      .button("setEntityTagBind", "Set entity-tag bind", { iconPath: ICONS.binding })
      .button("setItemLoreBind", "Set item lore bind", { iconPath: ICONS.edit })
      .button("setHeldItemLore", "Set held item lore", { iconPath: ICONS.edit })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "setItemBind") {
      const result = await TauUi.modal("Item Bind")
        .text("itemId", "Item type id", { placeholder: "minecraft:clock" })
        .text("menuId", "Menu id", { placeholder: "main_menu" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const itemId = String(result.values.itemId ?? "").trim();
      const menuId = String(result.values.menuId ?? "").trim();
      if (!itemId || !menuId) continue;
      state.binds.itemBinds[itemId] = menuId;
      state.binds.itemBinds[normalizeKey(itemId)] = menuId;
      saveBinds();
      tell(player, `Bound ${itemId} -> ${menuId}.`);
      continue;
    }

    if (response.id === "setEntityTagBind") {
      const result = await TauUi.modal("Entity Tag Bind")
        .text("tag", "Entity tag", { placeholder: "menuid:main_menu" })
        .text("menuId", "Menu id", { placeholder: "main_menu" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const tag = String(result.values.tag ?? "").trim();
      const menuId = String(result.values.menuId ?? "").trim();
      if (!tag || !menuId) continue;
      state.binds.entityTagBinds[tag] = menuId;
      saveBinds();
      tell(player, `Bound entity tag ${tag} -> ${menuId}.`);
      continue;
    }

    if (response.id === "setItemLoreBind") {
      const result = await TauUi.modal("Lore Item Bind")
        .text("menuId", "Menu id", { placeholder: "main_menu" })
        .text("loreLine", "Lore line to match", { placeholder: "Open Menu" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const menuId = String(result.values.menuId ?? "").trim();
      const loreLine = String(result.values.loreLine ?? "").trim();
      if (!menuId || !loreLine) continue;
      state.binds.itemBinds[`lore:${loreLine}`] = menuId;
      state.binds.itemBinds[`lore:${normalizeKey(loreLine)}`] = menuId;
      saveBinds();
      tell(player, `Bound lore "${loreLine}" -> ${menuId}.`);
      continue;
    }

    if (response.id === "setHeldItemLore") {
      const { ItemStack } = await import("@minecraft/server");
      const selected = player
        .getComponent((await import("@minecraft/server")).EntityComponentTypes.Inventory)
        ?.container?.getItem(player.selectedSlotIndex);
      if (!selected) {
        tell(player, "Hold an item first.");
        continue;
      }
      const result = await TauUi.modal("Set Held Item Lore")
        .text("loreText", "Lore lines (one per line)", { placeholder: "Line 1\nLine 2" })
        .submitButton("Apply")
        .show(player);
      if (result.canceled) continue;
      const loreText = String(result.values.loreText ?? "").trim();
      if (!loreText) continue;
      const lore = loreText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      selected.setLore(lore);
      const { getInventoryContainer } = await import("../../storage");
      const inv = getInventoryContainer(player);
      if (inv) inv.setItem(player.selectedSlotIndex, selected);
      tell(player, "Lore applied to held item.");
      continue;
    }

    return;
  }
}

export async function showConfigMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit config.");
    return;
  }

  while (true) {
    const features = state.config.features;
    const response = await TauUi.action("§bTau Config§r")
      .body("Toggle addon features on or off.")
      .button("creator", `Creator: ${features.creator ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("forms", `Forms: ${features.forms ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("shops", `Shops: ${features.shops ? "On" : "Off"}`, { iconPath: ICONS.shop })
      .button("sidebars", `Sidebars: ${features.sidebars ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("bindings", `Bindings: ${features.bindings ? "On" : "Off"}`, { iconPath: ICONS.binding })
      .button("stats", `Stats: ${features.stats ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("plots", `Plots: ${features.plots ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("tpa", `TPA: ${features.tpa ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("homes", `Homes: ${features.homes ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("pay", `Pay: ${features.pay ? "On" : "Off"}`, { iconPath: ICONS.shop })
      .button("playerConfig", `Player Config: ${features.playerConfig ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("teams", `Teams: ${features.teams ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("warps", `Warps: ${features.warps ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("plotTp", `Plot TP: ${features.plotTp ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("generators", `Generators: ${features.generators ? "On" : "Off"}`, { iconPath: ICONS.shop })
      .button("items", `TauItems: ${features.items ? "On" : "Off"}`, { iconPath: ICONS.utility })
      .button("combat", `Combat: ${features.combat ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("moderation", `Moderation: ${features.moderation ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("customAreas", `Custom Areas: ${features.customAreas ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("lootChests", `Loot Chests: ${features.lootChests ? "On" : "Off"}`, { iconPath: ICONS.item })
      .button("commandBuilder", `Command Builder: ${features.commandBuilder ? "On" : "Off"}`, { iconPath: ICONS.utility })
      .button("prune", "Prune Data", { iconPath: ICONS.delete })
      .button("socialSettings", "Social Settings", { iconPath: ICONS.settings })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "socialSettings") {
      const { showSocialSettingsAdmin } = await import("../social-ui");
      await showSocialSettingsAdmin(player);
      continue;
    }

    if (response.id === "prune") {
      await showPruneDataMenu(player);
      continue;
    }

    if (response.id === "warps") {
      features.warps = !features.warps;
      saveConfig();
      continue;
    }

    if (response.id === "plotTp") {
      features.plotTp = !features.plotTp;
      saveConfig();
      continue;
    }

    if (response.id === "generators") {
      features.generators = !features.generators;
      saveConfig();
      continue;
    }

    if (response.id === "items") {
      features.items = !features.items;
      saveConfig();
      continue;
    }

    if (response.id === "combat") {
      features.combat = !features.combat;
      saveConfig();
      continue;
    }

    if (response.id === "moderation") {
      features.moderation = !features.moderation;
      saveConfig();
      continue;
    }

    if (response.id === "customAreas") {
      features.customAreas = !features.customAreas;
      saveConfig();
      continue;
    }

    const keys: Record<string, keyof typeof features> = {
      creator: "creator", forms: "forms", shops: "shops", sidebars: "sidebars",
      bindings: "bindings", stats: "stats", plots: "plots", tpa: "tpa",
      homes: "homes", pay: "pay", playerConfig: "playerConfig", teams: "teams",
      lootChests: "lootChests", commandBuilder: "commandBuilder",
    };
    const key = keys[response.id];
    if (!key) continue;
    features[key] = !features[key];
    saveConfig();
  }
}

export async function showPruneDataMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit prune settings.");
    return;
  }

  while (true) {
    const prune = state.prune.config;
    const response = await TauUi.action("Prune Data")
      .body(`Enabled: ${prune.enabled ? "On" : "Off"}\nInactive days: ${prune.inactiveDays}\nFlags: stats, profiles, teams, plots, homes, tpa, pay, playerSettings`)
      .button("toggleEnabled", `Enabled: ${prune.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("setInactiveDays", "Set Inactive Days", { iconPath: ICONS.edit })
      .button("stats", `Stats: ${prune.flags.stats ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("profiles", `Profiles: ${prune.flags.profiles ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("teams", `Teams: ${prune.flags.teams ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("plots", `Plots: ${prune.flags.plots ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("homes", `Homes: ${prune.flags.homes ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("tpa", `TPA: ${prune.flags.tpa ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("pay", `Pay: ${prune.flags.pay ? "On" : "Off"}`, { iconPath: ICONS.shop })
      .button("playerSettings", `Player Settings: ${prune.flags.playerSettings ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("dryRun", "Dry Run", { iconPath: ICONS.confirm })
      .button("executePrune", "Execute Prune", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;

    if (response.id === "toggleEnabled") {
      prune.enabled = !prune.enabled;
      savePrune();
      continue;
    }
    if (response.id === "setInactiveDays") {
      const result = await TauUi.modal("Inactive Days")
        .text("days", "Days", { placeholder: "30", defaultValue: String(prune.inactiveDays) })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const days = Math.max(1, Math.floor(Number(result.values.days ?? 30)));
      if (Number.isFinite(days)) prune.inactiveDays = days;
      savePrune();
      continue;
    }

    const flagKeys: Record<string, keyof typeof prune.flags> = {
      stats: "stats", profiles: "profiles", teams: "teams", plots: "plots",
      homes: "homes", tpa: "tpa", pay: "pay", playerSettings: "playerSettings",
    };
    const flagKey = flagKeys[response.id];
    if (flagKey) {
      prune.flags[flagKey] = !prune.flags[flagKey];
      savePrune();
      continue;
    }

    if (response.id === "dryRun") {
      const result = pruneData(true);
      tellPruneResult(player, result, true);
      continue;
    }
    if (response.id === "executePrune") {
      const result = pruneData(false);
      tellPruneResult(player, result, false);
      continue;
    }
    if (response.id === "back") return;
  }
}
