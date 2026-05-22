import { Player, world } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS } from "../../types";
import { isOperator, saveGenerators, state, tell } from "../../storage";
import { getHeldItemSnapshot, applyHeldItemSnapshotToGenerator } from "../ui-utils";
import { addGeneratorTier, createGeneratorDefinition, deleteGeneratorDefinition, getGeneratorAutoBreakerCost, getGeneratorDefinition, getGeneratorInfoLines, getGeneratorTierSummary, getNextUpgradeCost, getPlacedGeneratorAtLocation, getPlacedGeneratorInfoLines, giveGenerator, listGeneratorDefinitions, pickupGenerator, removeGeneratorTier, toggleGeneratorAutoBreaker, updateGeneratorConfig, updateGeneratorDefinition, updateGeneratorTier, upgradeGenerator } from "../../generators";
import { parseEnchantmentsText } from "../../shared/enchantments";

export async function showGeneratorMenu(player: Player) {
  while (true) {
    const defs = listGeneratorDefinitions();
    const response = await TauUi.action("§bGenerators§r")
      .body("§7Place generators, sneak-left-click to pick them up.§r")
      .button("myGenerators", "My Generators", { iconPath: ICONS.menu })
      .button("placeGenerator", "Place Held Generator", { iconPath: ICONS.confirm })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;
    if (response.id === "myGenerators") {
      if (defs.length === 0) {
        tell(player, "No generators exist yet.");
        continue;
      }
      const pick = TauUi.action<{ defId: string }>("My Generators").body("Select a generator definition.");
      for (const def of defs) pick.button(def.id, def.name, { iconPath: ICONS.menu, value: { defId: def.id } });
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const info = getGeneratorInfoLines(picked.value.defId);
      tell(player, info.join(" | "));
      continue;
    }
    if (response.id === "placeGenerator") {
      tell(player, "Use a generator item on a block to place it.");
      continue;
    }
  }
}

export async function showGeneratorAdminMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to manage generators.");
    return;
  }
  while (true) {
    const defs = listGeneratorDefinitions();
    const response = await TauUi.action("§6Generator Admin§r")
      .body(`§7Create and manage generator definitions.\n§7Enabled: §f${state.generators.config.enabled ? "On" : "Off"}§7 | Place anywhere: §f${state.generators.config.defaultPlaceAnywhere ? "On" : "Off"}§7 | Plot-only: §f${state.generators.config.blockOnPlotOnly ? "On" : "Off"}`)
      .button("create", "Create Definition", { iconPath: ICONS.confirm })
      .button("give", "Give Generator", { iconPath: ICONS.binding })
      .button("edit", "Edit Definition", { iconPath: ICONS.edit })
      .button("manageTiers", "Manage Tiers", { iconPath: ICONS.edit })
      .button("manageAutobreakers", "Manage Autobreakers", { iconPath: ICONS.settings })
      .button("settings", "Generator Settings", { iconPath: ICONS.settings })
      .button("delete", "Delete Definition", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;
    if (response.id === "create") {
      const result = await TauUi.modal("Create Generator")
        .text("name", "Name", { placeholder: "Diamond Generator" })
        .text("baseItemId", "Base item id", { placeholder: "minecraft:bedrock" })
        .text("outputItemId", "Output item id", { placeholder: "minecraft:diamond" })
        .text("rateTicks", "Rate ticks", { placeholder: "200" })
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      const create = createGeneratorDefinition(String(result.values.name ?? ""), String(result.values.baseItemId ?? ""), String(result.values.outputItemId ?? ""), Number(result.values.rateTicks ?? 200));
      if (create.ok) {
        const held = getHeldItemSnapshot(player);
        const def = getGeneratorDefinition(String(result.values.name ?? "").trim().toLowerCase());
        if (def && held) {
          applyHeldItemSnapshotToGenerator(def, held);
          saveGenerators();
        }
      }
      tell(player, create.message);
      continue;
    }
    if (response.id === "give") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = TauUi.action<{ defId: string }>("Give Generator").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.id, def.name, { iconPath: ICONS.menu, value: { defId: def.id } });
      targetPick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await targetPick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      tell(player, giveGenerator(player, picked.value.defId).message);
      continue;
    }
    if (response.id === "edit") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = TauUi.action<{ defId: string }>("Edit Generator").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.id, def.name, { iconPath: ICONS.edit, value: { defId: def.id } });
      targetPick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await targetPick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const def = getGeneratorDefinition(picked.value.defId)!;
      const result = await TauUi.modal(`Edit Generator: ${def.name}`)
        .text("name", "Name", { placeholder: "Diamond Generator", defaultValue: def.name })
        .text("baseItemId", "Base item id", { placeholder: "minecraft:bedrock", defaultValue: def.baseItemId })
        .text("outputItemId", "Output item id", { placeholder: "minecraft:diamond", defaultValue: def.outputItemId })
        .text("displayName", "Display name", { placeholder: "Diamond Generator", defaultValue: def.displayName ?? def.name })
        .text("lore", "Lore (one line per line)", { placeholder: "Line 1|Line 2", defaultValue: (def.lore ?? []).join("|") })
        .text("enchantments", "Enchantments (id=level)", { placeholder: "sharpness=1", defaultValue: (def.enchantments ?? []).map((entry) => `${entry.id}=${entry.level}`).join(",") })
        .text("customData", "Custom data JSON", { placeholder: "{}", defaultValue: def.customData ?? "{}" })
        .text("canPlaceOn", "Can place on", { placeholder: "minecraft:stone", defaultValue: (def.canPlaceOn ?? []).join(",") })
        .text("canDestroy", "Can destroy", { placeholder: "minecraft:glass", defaultValue: (def.canDestroy ?? []).join(",") })
        .text("autoBreakerCost", "Autobreaker price (blank = default)", { placeholder: String(getGeneratorAutoBreakerCost(def)), defaultValue: def.autoBreakerCost !== undefined ? String(def.autoBreakerCost) : "" })
        .text("durability", "Durability damage", { placeholder: "0", defaultValue: String(def.durability ?? 0) })
        .text("maxDurability", "Max durability", { placeholder: "0", defaultValue: String(def.maxDurability ?? 0) })
        .toggle("placeAnywhere", "Place anywhere", def.placeAnywhere)
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      tell(player, updateGeneratorDefinition(def.id, {
        name: String(result.values.name ?? def.name),
        baseItemId: String(result.values.baseItemId ?? def.baseItemId),
        outputItemId: String(result.values.outputItemId ?? def.outputItemId),
        displayName: String(result.values.displayName ?? def.displayName ?? def.name),
        lore: String(result.values.lore ?? "").split("|").map((line) => line.trim()).filter((line) => line.length > 0),
        enchantments: parseEnchantmentsText(String(result.values.enchantments ?? "")),
        customData: String(result.values.customData ?? "{}").trim() || undefined,
        canPlaceOn: String(result.values.canPlaceOn ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0),
        canDestroy: String(result.values.canDestroy ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0),
        autoBreakerCost: String(result.values.autoBreakerCost ?? "").trim().length > 0 ? Number(result.values.autoBreakerCost) : undefined,
        durability: Number(result.values.durability ?? 0),
        maxDurability: Number(result.values.maxDurability ?? 0),
        placeAnywhere: Boolean(result.values.placeAnywhere),
      }).message);
      continue;
    }
    if (response.id === "manageTiers") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = TauUi.action<{ defId: string }>("Manage Tiers").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.id, def.name, { iconPath: ICONS.edit, value: { defId: def.id } });
      targetPick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await targetPick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      await showGeneratorTierManager(player, picked.value.defId);
      continue;
    }
    if (response.id === "manageAutobreakers") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = TauUi.action<{ defId: string }>("Manage Autobreakers").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.id, def.name, { iconPath: ICONS.settings, value: { defId: def.id } });
      targetPick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await targetPick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const def = getGeneratorDefinition(picked.value.defId)!;
      const maxTier = def.tiers.reduce((highest, tier) => Math.max(highest, tier.tier), 1);
      const placements = Object.values(state.generators.placed).filter((placed) => placed.definitionId === def.id && placed.tier >= maxTier);
      if (placements.length === 0) {
        tell(player, "No max-tier generators of that definition are placed.");
        continue;
      }
      const placePick = TauUi.action<{ index: number }>(`Autobreakers: ${def.name}`).body("Select a placed generator to toggle.");
      for (let i = 0; i < placements.length; i++) {
        const placed = placements[i];
        const status = placed.autoBreakerPurchased ? (placed.autoBreakerEnabled ? "On" : "Off") : "Locked";
        placePick.button(String(i), `${placed.dimensionId} @ ${placed.x}, ${placed.y}, ${placed.z} | ${status}`, { iconPath: ICONS.settings, value: { index: i } });
      }
      placePick.button("back", "Back", { iconPath: ICONS.back });
      const placedPick = await placePick.show(player);
      if (placedPick.canceled || placedPick.id === "back") continue;
      if (placedPick.value === undefined) continue;
      const placed = placements[placedPick.value.index];
      const toggle = toggleGeneratorAutoBreaker(player, { x: placed.x, y: placed.y, z: placed.z }, placed.dimensionId);
      tell(player, toggle.ok ? `§a[Generators] ${toggle.message}` : `§c[Generators] ${toggle.message}`);
      continue;
    }
    if (response.id === "settings") {
      await showGeneratorSettingsMenu(player);
      continue;
    }
    if (response.id === "delete") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const targetPick = TauUi.action<{ defId: string }>("Delete Generator").body("Select a generator definition.");
      for (const def of defs) targetPick.button(def.id, def.name, { iconPath: ICONS.delete, value: { defId: def.id } });
      targetPick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await targetPick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      tell(player, deleteGeneratorDefinition(picked.value.defId).message);
      continue;
    }
  }
}

async function showGeneratorTierManager(player: Player, defId: string) {
  while (true) {
    const def = getGeneratorDefinition(defId);
    if (!def) {
      tell(player, "Generator not found.");
      return;
    }

    const tiers = def.tiers.slice().sort((a, b) => a.tier - b.tier);
    const response = await TauUi.action(`Tiers: ${def.name}`)
      .body(getGeneratorInfoLines(def.id).join("\n"))
      .button("addTier", "Add Tier", { iconPath: ICONS.confirm })
      .button("editTier", "Edit Tier", { iconPath: ICONS.edit })
      .button("removeTier", "Remove Tier", { iconPath: ICONS.delete })
      .button("setAutoBreakerPrice", "Set Autobreaker Price", { iconPath: ICONS.settings })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "addTier") {
      const result = await TauUi.modal(`Add Tier: ${def.name}`)
        .text("rateTicks", "Rate ticks", { placeholder: "0" })
        .text("upgradeCost", "Upgrade cost", { placeholder: "1000" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      tell(player, addGeneratorTier(def.id, Number(result.values.rateTicks ?? 200), Number(result.values.upgradeCost ?? 1000)).message);
      continue;
    }

    if (response.id === "editTier") {
      if (tiers.length === 0) continue;
      const pick = TauUi.action<{ tierIndex: number }>(`Edit Tier: ${def.name}`).body("Select a tier to edit.");
      for (let i = 0; i < tiers.length; i++) {
        pick.button(String(i), getGeneratorTierSummary(def.id, tiers[i].tier) ?? `Tier ${tiers[i].tier}`, { iconPath: ICONS.edit, value: { tierIndex: i } });
      }
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const tier = tiers[picked.value.tierIndex];
      const editResult = await TauUi.modal(`Edit Tier ${tier.tier}: ${def.name}`)
        .text("rateTicks", "Rate ticks", { placeholder: "0", defaultValue: String(tier.rateTicks) })
        .text("upgradeCost", "Upgrade cost", { placeholder: "1000", defaultValue: String(tier.upgradeCost) })
        .submitButton("Save")
        .show(player);
      if (editResult.canceled) continue;
      tell(player, updateGeneratorTier(def.id, tier.tier, {
        rateTicks: Number(editResult.values.rateTicks ?? tier.rateTicks),
        upgradeCost: Number(editResult.values.upgradeCost ?? tier.upgradeCost),
      }).message);
      continue;
    }

    if (response.id === "removeTier") {
      if (tiers.length === 0) continue;
      const pick = TauUi.action<{ tierIndex: number }>(`Remove Tier: ${def.name}`).body("Select a tier to remove.");
      for (let i = 0; i < tiers.length; i++) {
        pick.button(String(i), getGeneratorTierSummary(def.id, tiers[i].tier) ?? `Tier ${tiers[i].tier}`, { iconPath: ICONS.delete, value: { tierIndex: i } });
      }
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back") continue;
      if (picked.value === undefined) continue;
      const tier = tiers[picked.value.tierIndex];
      tell(player, removeGeneratorTier(def.id, tier.tier).message);
      continue;
    }

    if (response.id === "setAutoBreakerPrice") {
      const result = await TauUi.modal(`Autobreaker Price: ${def.name}`)
        .text("autoBreakerCost", "Custom autobreaker price (blank = default)", { placeholder: String(getGeneratorAutoBreakerCost(def)), defaultValue: def.autoBreakerCost !== undefined ? String(def.autoBreakerCost) : "" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const raw = String(result.values.autoBreakerCost ?? "").trim();
      tell(player, updateGeneratorDefinition(def.id, { autoBreakerCost: raw.length > 0 ? Number(raw) : undefined }).message);
      continue;
    }
  }
}

export async function showGeneratorSettingsMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit generator settings.");
    return;
  }

  while (true) {
    const config = state.generators.config;
    const response = await TauUi.action("§bGenerator Settings§r")
      .body(`§7Global generator behavior.§r\n§7Autobreakers: §f${config.autoBreakersEnabled ? "On" : "Off"}`)
      .button("toggleEnabled", `Generators: ${config.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("togglePlaceAnywhere", `Default place anywhere: ${config.defaultPlaceAnywhere ? "On" : "Off"}`, { iconPath: ICONS.shop })
      .button("togglePlotOnly", `Block on plots only: ${config.blockOnPlotOnly ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
      .button("toggleAutobreakers", `Autobreakers: ${config.autoBreakersEnabled ? "On" : "Off"}`, { iconPath: ICONS.confirm })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "toggleEnabled") {
      updateGeneratorConfig({ enabled: !config.enabled });
      continue;
    }

    if (response.id === "togglePlaceAnywhere") {
      updateGeneratorConfig({ defaultPlaceAnywhere: !config.defaultPlaceAnywhere });
      continue;
    }

    if (response.id === "togglePlotOnly") {
      updateGeneratorConfig({ blockOnPlotOnly: !config.blockOnPlotOnly });
      continue;
    }

    if (response.id === "toggleAutobreakers") {
      updateGeneratorConfig({ autoBreakersEnabled: !config.autoBreakersEnabled });
      continue;
    }
  }
}

export async function showGeneratorUpgradeMenu(player: Player, defId: string, location: { x: number; y: number; z: number }, dimensionId: string) {
  const def = getGeneratorDefinition(defId);
  if (!def) {
    tell(player, "Generator not found.");
    return;
  }
  const placedInfo = getPlacedGeneratorInfoLines(location, dimensionId);
  const upgrade = getNextUpgradeCost(location, dimensionId);
  const maxTier = def.tiers.reduce((highest, tier) => Math.max(highest, tier.tier), 1);
  const autobreakerCost = getGeneratorAutoBreakerCost(def);
  const placed = getPlacedGeneratorAtLocation(location, dimensionId);
  const autobreakerLine = placed?.autoBreakerPurchased
    ? `§eAutobreaker§r: §f${placed.autoBreakerEnabled ? "On" : "Off"}§7 | Toggle: use the Autobreaker button`
    : upgrade
      ? `§7Autobreaker unlocks at max tier (${maxTier}).`
      : `§eAutobreaker§r: §f$${autobreakerCost}§7 (${def.autoBreakerCost !== undefined ? "custom" : "default"})`;
  const upgradeLine = upgrade
    ? `§eNext upgrade§r: §fTier ${upgrade.nextTier} for $${upgrade.cost}`
    : "§7Max tier reached.";
  const title = `§b${def.name}§r`;

  const response = await TauUi.action(title)
    .body(`${placedInfo.join("\n")}
${upgradeLine}
${autobreakerLine}

Location: ${dimensionId} (${location.x}, ${location.y}, ${location.z})`)
    .button("upgrade", "Upgrade Tier", { iconPath: ICONS.edit })
    .button("toggleAutobreaker", placed?.autoBreakerPurchased ? "Toggle Autobreaker" : (upgrade ? "Autobreaker Locked" : "Buy Autobreaker"), { iconPath: ICONS.settings })
    .button("info", "Info", { iconPath: ICONS.menu })
    .button("pickup", "§cPickup Generator§r", { iconPath: ICONS.delete })
    .button("back", "Back", { iconPath: ICONS.back })
    .show(player);
  if (response.canceled || response.id === undefined) return;

  if (response.id === "upgrade") {
    const confirmed = await TauUi.confirm(player, {
      title: "§cConfirm Upgrade§r",
      body: `§eUpgrade ${def.name}?§r\n${placedInfo.join("\n")}\n§6Price§r: §a$${upgrade?.cost ?? 0}§r`,
      confirmText: "Confirm Upgrade",
      cancelText: "Cancel",
    });
    if (!confirmed) return;
    const upgradeResult = upgradeGenerator(player, location, dimensionId);
    tell(player, upgradeResult.ok ? `§a[Generators] ${upgradeResult.message}` : `§c[Generators] ${upgradeResult.message}`);
    return;
  }
  if (response.id === "toggleAutobreaker") {
    if (!placed?.autoBreakerPurchased && upgrade) {
      tell(player, "§7Autobreaker unlocks after max tier.");
      return;
    }
    const toggle = toggleGeneratorAutoBreaker(player, location, dimensionId);
    tell(player, toggle.ok ? `§a[Generators] ${toggle.message}` : `§c[Generators] ${toggle.message}`);
    return;
  }
  if (response.id === "info") {
    tell(player, getGeneratorInfoLines(def.id).join(" | "));
    return;
  }
  if (response.id === "pickup") {
    const picked = pickupGenerator(player, location, dimensionId);
    tell(player, picked.ok ? `§a[Generators] ${picked.message}` : `§c[Generators] ${picked.message}`);
  }
}
