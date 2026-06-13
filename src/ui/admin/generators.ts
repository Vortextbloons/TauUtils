import { Player, world } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS } from "../../types";
import { isOperator, saveGenerators, state, tell } from "../../storage";
import { getHeldItemSnapshot, applyHeldItemSnapshotToGenerator } from "../ui-utils";
import {
  addGeneratorOutputEntry,
  addGeneratorTier,
  createGeneratorDefinition,
  createWeightedGeneratorDefinition,
  deleteGeneratorDefinition,
  getGeneratorAutoBreakerCost,
  getGeneratorDefinition,
  getGeneratorInfoLines,
  getGeneratorOutputChanceText,
  getGeneratorTierSummary,
  getNextUpgradeCost,
  getPlacedGeneratorAtLocation,
  getPlacedGeneratorInfoLines,
  giveGenerator,
  listGeneratorDefinitions,
  pickupGenerator,
  removeGeneratorOutputEntry,
  removeGeneratorTier,
  toggleGeneratorAutoBreaker,
  updateGeneratorConfig,
  updateGeneratorDefinition,
  updateGeneratorOutputEntry,
  updateGeneratorTier,
  upgradeGenerator,
  canPlayerManagePlacedGenerator,
} from "../../generators";
import { parseEnchantmentsText } from "../../shared/enchantments";

async function pickGeneratorDefinitionId(
  player: Player,
  defs: ReturnType<typeof listGeneratorDefinitions>,
  title: string,
  iconPath: string,
  body = "Select a generator definition.",
): Promise<string | undefined> {
  return TauUi.pickFromList(player, {
    title,
    body,
    backIconPath: ICONS.back,
    items: defs.map((def) => ({ id: def.id, text: def.name, iconPath, value: def.id })),
  });
}

export async function showGeneratorMenu(player: Player) {
  while (true) {
    const defs = listGeneratorDefinitions();
    const response = await TauUi.action("§bGenerators§r")
      .body("§7Place generators, sneak-left-click to pick them up.§r")
      .button("myGenerators", "My Generators", { iconPath: ICONS.menu })
      .button("placeGenerator", "Place Held Generator", { iconPath: ICONS.confirm })
      .back("Back", ICONS.back)
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "back") return;
    if (response.id === "myGenerators") {
      if (defs.length === 0) {
        tell(player, "No generators exist yet.");
        continue;
      }
      const defId = await pickGeneratorDefinitionId(player, defs, "My Generators", ICONS.menu);
      if (!defId) continue;
      const info = getGeneratorInfoLines(defId);
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
      .button("createWeighted", "Create Weighted Generator", { iconPath: ICONS.confirm })
      .button("give", "Give Generator", { iconPath: ICONS.binding })
      .button("edit", "Edit Definition", { iconPath: ICONS.edit })
      .button("manageTiers", "Manage Tiers", { iconPath: ICONS.edit })
      .button("manageAutobreakers", "Manage Autobreakers", { iconPath: ICONS.settings })
      .button("settings", "Generator Settings", { iconPath: ICONS.settings })
      .button("delete", "Delete Definition", { iconPath: ICONS.delete })
      .back("Back", ICONS.back)
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "back") return;
    if (response.id === "create") {
      const result = await TauUi.modal("Create Generator")
        .text("name", "Name", { placeholder: "Diamond Generator" })
        .text("baseItemId", "Base item id", { placeholder: "minecraft:bedrock" })
        .text("outputItemId", "Output item id", { placeholder: "minecraft:diamond" })
        .text("rateTicks", "Rate ticks", { placeholder: "200" })
        .toggle("adminProtected", "Admin protected (view-only for players)", false)
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      const create = createGeneratorDefinition(
        String(result.values.name ?? ""),
        String(result.values.baseItemId ?? ""),
        String(result.values.outputItemId ?? ""),
        Number(result.values.rateTicks ?? 200),
        Boolean(result.values.adminProtected)
      );
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
    if (response.id === "createWeighted") {
      const result = await TauUi.modal("Create Weighted Generator")
        .text("name", "Name", { placeholder: "Ore Generator" })
        .text("baseItemId", "Base item id", { placeholder: "minecraft:bedrock" })
        .text("firstOutputId", "First pool block id", { placeholder: "minecraft:diamond_ore" })
        .text("firstWeight", "First pool weight", { placeholder: "10" })
        .text("rateTicks", "Rate ticks (0 = turbo)", { placeholder: "200" })
        .toggle("adminProtected", "Admin protected (view-only for players)", false)
        .submitButton("Create")
        .show(player);
      if (result.canceled) continue;
      const create = createWeightedGeneratorDefinition(
        String(result.values.name ?? ""),
        String(result.values.baseItemId ?? ""),
        [{ itemId: String(result.values.firstOutputId ?? ""), weight: Number(result.values.firstWeight ?? 1) }],
        Number(result.values.rateTicks ?? 200),
        Boolean(result.values.adminProtected)
      );
      if (create.ok) {
        const held = getHeldItemSnapshot(player);
        const def = getGeneratorDefinition(String(result.values.name ?? "").trim().toLowerCase());
        if (def && held) {
          applyHeldItemSnapshotToGenerator(def, held);
          saveGenerators();
        }
        if (def) await showGeneratorOutputPoolManager(player, def.id);
      }
      tell(player, create.message);
      continue;
    }
    if (response.id === "give") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const defId = await pickGeneratorDefinitionId(player, defs, "Give Generator", ICONS.menu);
      if (!defId) continue;
      tell(player, giveGenerator(player, defId).message);
      continue;
    }
    if (response.id === "edit") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const defId = await pickGeneratorDefinitionId(player, defs, "Edit Generator", ICONS.edit);
      if (!defId) continue;
      const def = getGeneratorDefinition(defId)!;
      if (def.kind === "weighted") {
        const editAction = await TauUi.action(`Edit: ${def.name}`)
          .body("§7Weighted generator — edit metadata or manage the output pool.§r")
          .button("editMeta", "Edit Metadata", { iconPath: ICONS.edit })
          .button("managePool", "Manage Output Pool", { iconPath: ICONS.menu })
          .back("Back", ICONS.back)
          .show(player);
        if (TauUi.isCanceledOrBack(editAction)) continue;
        if (editAction.id === "managePool") {
          await showGeneratorOutputPoolManager(player, def.id);
          continue;
        }
      }
      const modal = TauUi.modal(`Edit Generator: ${def.name}`)
        .text("name", "Name", { placeholder: "Diamond Generator", defaultValue: def.name })
        .text("baseItemId", "Base item id", { placeholder: "minecraft:bedrock", defaultValue: def.baseItemId })
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
        .toggle("adminProtected", "Admin protected (view-only for players)", Boolean(def.adminProtected));
      if (def.kind === "fixed") {
        modal.text("outputItemId", "Output item id", { placeholder: "minecraft:diamond", defaultValue: def.outputItemId });
      }
      const result = await modal.submitButton("Save").show(player);
      if (result.canceled) continue;
      const patch: Parameters<typeof updateGeneratorDefinition>[1] = {
        name: String(result.values.name ?? def.name),
        baseItemId: String(result.values.baseItemId ?? def.baseItemId),
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
        adminProtected: Boolean(result.values.adminProtected),
      };
      if (def.kind === "fixed") {
        patch.outputItemId = String(result.values.outputItemId ?? def.outputItemId);
      }
      tell(player, updateGeneratorDefinition(def.id, patch).message);
      continue;
    }
    if (response.id === "manageTiers") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const defId = await pickGeneratorDefinitionId(player, defs, "Manage Tiers", ICONS.edit);
      if (!defId) continue;
      await showGeneratorTierManager(player, defId);
      continue;
    }
    if (response.id === "manageAutobreakers") {
      if (defs.length === 0) {
        tell(player, "No generator definitions available.");
        continue;
      }
      const defId = await pickGeneratorDefinitionId(player, defs, "Manage Autobreakers", ICONS.settings);
      if (!defId) continue;
      const def = getGeneratorDefinition(defId)!;
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
      placePick.back("Back", ICONS.back);
      const placedPick = await placePick.show(player);
      if (TauUi.isCanceledOrBack(placedPick)) continue;
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
      const defId = await pickGeneratorDefinitionId(player, defs, "Delete Generator", ICONS.delete);
      if (!defId) continue;
      tell(player, deleteGeneratorDefinition(defId).message);
      continue;
    }
  }
}

async function showGeneratorOutputPoolManager(player: Player, defId: string) {
  while (true) {
    const def = getGeneratorDefinition(defId);
    if (!def || def.kind !== "weighted") {
      tell(player, "Weighted generator not found.");
      return;
    }
    const pool = def.outputPool ?? [];
    const menu = TauUi.action<{ entryIndex?: number }>(`Output Pool: ${def.name}`)
      .body(pool.length === 0 ? "§cNo valid pool entries.§r" : `§7${pool.length} weighted block(s).§r`);
    for (let i = 0; i < pool.length; i++) {
      const entry = pool[i];
      menu.button(`entry_${i}`, `${entry.itemId} | w${entry.weight} | ${getGeneratorOutputChanceText(def.id, i)}`, {
        iconPath: ICONS.menu,
        value: { entryIndex: i },
      });
    }
    menu
      .button("add", "Add Entry", { iconPath: ICONS.confirm })
      .back("Back", ICONS.back);
    const response = await menu.show(player);
    if (TauUi.isCanceledOrBack(response)) return;

    if (response.id === "add") {
      const addResult = await TauUi.modal(`Add Pool Entry: ${def.name}`)
        .text("itemId", "Block item id", { placeholder: "minecraft:iron_ore" })
        .text("weight", "Weight", { placeholder: "10" })
        .submitButton("Add")
        .show(player);
      if (addResult.canceled) continue;
      tell(player, addGeneratorOutputEntry(def.id, String(addResult.values.itemId ?? ""), Number(addResult.values.weight ?? 1)).message);
      continue;
    }

    if (response.value?.entryIndex === undefined) continue;
    const entryIndex = response.value.entryIndex;
    const entry = pool[entryIndex];
    if (!entry) continue;

    const editAction = await TauUi.action(`Pool Entry: ${entry.itemId}`)
      .body(`${entry.itemId} | weight ${entry.weight} | ${getGeneratorOutputChanceText(def.id, entryIndex)}`)
      .button("edit", "Edit Entry", { iconPath: ICONS.edit })
      .button("remove", "Remove Entry", { iconPath: ICONS.delete })
      .back("Back", ICONS.back)
      .show(player);
    if (TauUi.isCanceledOrBack(editAction)) continue;

    if (editAction.id === "edit") {
      const editResult = await TauUi.modal(`Edit Pool Entry: ${def.name}`)
        .text("itemId", "Block item id", { placeholder: entry.itemId, defaultValue: entry.itemId })
        .text("weight", "Weight", { placeholder: "10", defaultValue: String(entry.weight) })
        .submitButton("Save")
        .show(player);
      if (editResult.canceled) continue;
      tell(player, updateGeneratorOutputEntry(def.id, entryIndex, {
        itemId: String(editResult.values.itemId ?? entry.itemId),
        weight: Number(editResult.values.weight ?? entry.weight),
      }).message);
      continue;
    }

    if (editAction.id === "remove") {
      if (pool.length <= 1) {
        tell(player, "Cannot remove the last pool entry.");
        continue;
      }
      const confirmed = await TauUi.confirm(player, {
        title: "§cRemove Pool Entry§r",
        body: `Remove §f${entry.itemId}§r from §f${def.name}§r?`,
        confirmText: "Remove",
        cancelText: "Cancel",
      });
      if (!confirmed) continue;
      tell(player, removeGeneratorOutputEntry(def.id, entryIndex).message);
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
    const tierMenu = TauUi.action(`Tiers: ${def.name}`)
      .body(`${getGeneratorInfoLines(def.id).join("\n")}\n§7Rate ticks: §f0 = turbo (max speed)§r`)
      .button("addTier", "Add Tier", { iconPath: ICONS.confirm })
      .button("editTier", "Edit Tier", { iconPath: ICONS.edit })
      .button("removeTier", "Remove Tier", { iconPath: ICONS.delete })
      .button("setAutoBreakerPrice", "Set Autobreaker Price", { iconPath: ICONS.settings });
    if (def.kind === "weighted") {
      tierMenu.button("managePool", "Manage Output Pool", { iconPath: ICONS.menu });
    }
    const response = await tierMenu.back("Back", ICONS.back).show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "back") return;

    if (response.id === "addTier") {
      const result = await TauUi.modal(`Add Tier: ${def.name}`)
        .text("rateTicks", "Rate ticks (0 = turbo)", { placeholder: "0" })
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
      pick.back("Back", ICONS.back);
      const picked = await pick.show(player);
      if (TauUi.isCanceledOrBack(picked)) continue;
      if (picked.value === undefined) continue;
      const tier = tiers[picked.value.tierIndex];
      const editResult = await TauUi.modal(`Edit Tier ${tier.tier}: ${def.name}`)
        .text("rateTicks", "Rate ticks (0 = turbo)", { placeholder: "0", defaultValue: String(tier.rateTicks) })
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
      pick.back("Back", ICONS.back);
      const picked = await pick.show(player);
      if (TauUi.isCanceledOrBack(picked)) continue;
      if (picked.value === undefined) continue;
      const tier = tiers[picked.value.tierIndex];
      tell(player, removeGeneratorTier(def.id, tier.tier).message);
      continue;
    }

    if (response.id === "managePool") {
      await showGeneratorOutputPoolManager(player, def.id);
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
      .back("Back", ICONS.back)
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
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
  const canManage = canPlayerManagePlacedGenerator(player, def);
  const adminNote = def.adminProtected ? "\n§6Admin generator§r: §7operators can manage; you can view only.§r" : "";

  const menu = TauUi.action(title)
    .body(`${placedInfo.join("\n")}
${canManage ? `${upgradeLine}\n${autobreakerLine}` : "§7Upgrades and autobreaker are locked on this generator.§r"}
${adminNote}

Location: ${dimensionId} (${location.x}, ${location.y}, ${location.z})`)
    .button("info", "Definition Info", { iconPath: ICONS.menu });

  if (canManage) {
    menu
      .button("upgrade", "Upgrade Tier", { iconPath: ICONS.edit })
      .button("toggleAutobreaker", placed?.autoBreakerPurchased ? "Toggle Autobreaker" : (upgrade ? "Autobreaker Locked" : "Buy Autobreaker"), { iconPath: ICONS.settings })
      .button("pickup", "§cPickup Generator§r", { iconPath: ICONS.delete });
  }

  const response = await menu.back("Back", ICONS.back).show(player);
  if (TauUi.isCanceledOrBack(response)) return;

  if (response.id === "upgrade") {
    if (!canManage) {
      tell(player, "§c[Generators] This admin generator cannot be upgraded.");
      return;
    }
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
    if (!canManage) {
      tell(player, "§c[Generators] This admin generator cannot be changed.");
      return;
    }
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
    if (!canManage) {
      tell(player, "§c[Generators] This admin generator cannot be picked up.");
      return;
    }
    const picked = pickupGenerator(player, location, dimensionId);
    tell(player, picked.ok ? `§a[Generators] ${picked.message}` : `§c[Generators] ${picked.message}`);
  }
}
