import { Player } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS } from "../../types";
import { findForm, isFeatureEnabled, isOperator, normalizeKey, saveBinds, saveConfig, savePrune, state, tell } from "../../storage";
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
      .button("viewBindings", "View bindings", { iconPath: ICONS.binding })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "viewBindings") {
      await showBindingsViewer(player);
      continue;
    }

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

type BindingRow = {
  kind: "item" | "itemLore" | "entityTag";
  rawKey: string;
  displayKey: string;
  menuId: string;
};

const LORE_KEY_PREFIX = "lore:";

function buildBindingRows(): BindingRow[] {
  const rows: BindingRow[] = [];
  const seen = new Set<string>();

  for (const rawKey of Object.keys(state.binds.itemBinds)) {
    if (seen.has(rawKey)) continue;
    seen.add(rawKey);

    const norm = normalizeKey(rawKey);
    if (norm !== rawKey && seen.has(norm)) continue;
    if (norm !== rawKey) seen.add(norm);

    const isLore =
      rawKey.startsWith(LORE_KEY_PREFIX) || norm.startsWith(LORE_KEY_PREFIX);
    rows.push({
      kind: isLore ? "itemLore" : "item",
      rawKey,
      displayKey: isLore ? rawKey.slice(LORE_KEY_PREFIX.length) : rawKey,
      menuId: state.binds.itemBinds[rawKey],
    });
  }

  for (const rawKey of Object.keys(state.binds.entityTagBinds)) {
    if (seen.has(rawKey)) continue;
    seen.add(rawKey);
    rows.push({
      kind: "entityTag",
      rawKey,
      displayKey: rawKey,
      menuId: state.binds.entityTagBinds[rawKey],
    });
  }

  return rows;
}

function bindingKindLabel(kind: BindingRow["kind"]): string {
  if (kind === "item") return "Item bind";
  if (kind === "itemLore") return "Lore bind";
  return "Entity tag bind";
}

function bindingKindTrigger(kind: BindingRow["kind"]): string {
  if (kind === "entityTag") return "playerInteractWithEntity";
  return "itemUse";
}

function bindingRowIcon(kind: BindingRow["kind"]): string {
  if (kind === "itemLore") return ICONS.edit;
  if (kind === "entityTag") return ICONS.command;
  return ICONS.binding;
}

function deleteBindingRow(row: BindingRow): void {
  const norm = normalizeKey(row.rawKey);
  if (row.kind === "entityTag") {
    delete state.binds.entityTagBinds[row.rawKey];
    saveBinds();
    return;
  }
  delete state.binds.itemBinds[row.rawKey];
  if (norm !== row.rawKey) delete state.binds.itemBinds[norm];
  if (row.kind === "itemLore") {
    const loreNorm = `lore:${norm}`;
    if (loreNorm !== row.rawKey) delete state.binds.itemBinds[loreNorm];
  }
  saveBinds();
}

export async function showBindingsViewer(player: Player) {
  if (!isFeatureEnabled("bindings")) {
    tell(player, "Bindings are disabled.");
    return;
  }

  while (true) {
    const allRows = buildBindingRows();
    const itemRows = allRows.filter((r) => r.kind === "item");
    const loreRows = allRows.filter((r) => r.kind === "itemLore");
    const entityRows = allRows.filter((r) => r.kind === "entityTag");

    const response = await TauUi.action("View Bindings")
      .body(
        `Total bindings: ${allRows.length} (items: ${itemRows.length}, lore: ${loreRows.length}, entity tags: ${entityRows.length})`
      )
      .button("itemBinds", `Item binds (${itemRows.length})`, { iconPath: ICONS.binding })
      .button("loreBinds", `Lore binds (${loreRows.length})`, { iconPath: ICONS.edit })
      .button("entityTagBinds", `Entity tag binds (${entityRows.length})`, { iconPath: ICONS.binding })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (response.canceled || response.id === undefined) return;
    if (response.id === "back") return;

    if (response.id === "itemBinds") {
      await showBindingsList(player, "Item Binds", itemRows);
      continue;
    }
    if (response.id === "loreBinds") {
      await showBindingsList(player, "Lore Binds", loreRows);
      continue;
    }
    if (response.id === "entityTagBinds") {
      await showBindingsList(player, "Entity Tag Binds", entityRows);
      continue;
    }
  }
}

async function showBindingsList(
  player: Player,
  title: string,
  rows: readonly BindingRow[]
): Promise<void> {
  if (rows.length === 0) {
    await TauUi.action(title)
      .label("No bindings of this kind.")
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    return;
  }

  let page = 0;
  const pageSize = 12;
  while (true) {
    const slice = TauUi.paginate(rows, page, pageSize);
    const form = TauUi.action<number>(`${title} ${slice.page + 1}/${slice.pageCount}`);
    for (let i = 0; i < slice.items.length; i++) {
      const absoluteIndex = slice.startIndex + i;
      const row = slice.items[absoluteIndex];
      const form_ = findForm(row.menuId);
      const labelText = form_
        ? `${row.displayKey} -> ${row.menuId}`
        : `${row.displayKey} -> ${row.menuId} §c(missing)§r`;
      form.button("view", labelText, {
        iconPath: bindingRowIcon(row.kind),
        value: absoluteIndex,
      });
    }
    if (slice.hasPrevious) form.button("previous", "Previous", { iconPath: ICONS.back });
    if (slice.hasNext) form.button("next", "Next", { iconPath: ICONS.back });
    form.button("back", "Back", { iconPath: ICONS.back });

    const result = await form.show(player);
    if (result.canceled || result.id === "back") return;
    if (result.id === "previous" && slice.hasPrevious) {
      page--;
      continue;
    }
    if (result.id === "next" && slice.hasNext) {
      page++;
      continue;
    }
    if (result.id === "view" && result.value !== undefined) {
      const selected = rows[result.value];
      if (selected) {
        const action = await showBindingDetail(player, selected);
        if (action === "deleted") return;
      }
      continue;
    }
  }
}

async function showBindingDetail(
  player: Player,
  row: BindingRow
): Promise<"deleted" | "kept"> {
  while (true) {
    const formDef = findForm(row.menuId);
    const norm = normalizeKey(row.rawKey);

    const form = TauUi.action(`Binding: ${row.displayKey}`)
      .label(`Kind: ${bindingKindLabel(row.kind)}`)
      .label(`Key: ${row.rawKey}`)
      .label(`Normalized: ${norm}`)
      .label(`Menu id: ${row.menuId}`);

    if (formDef) {
      form.label(`Status: §a${formDef.title}§r (${formDef.layout})`);
    } else {
      form.label(`Status: §cMenu not found§r`);
    }

    form.label(`Trigger: ${bindingKindTrigger(row.kind)}`);

    if (formDef) {
      form.button("test", "Test (open menu)", { iconPath: ICONS.confirm });
    }
    form.button("delete", "Delete", { iconPath: ICONS.delete });
    form.button("back", "Back", { iconPath: ICONS.back });

    const result = await form.show(player);
    if (result.canceled || result.id === "back") return "kept";

    if (result.id === "test" && formDef) {
      const { openFormById } = await import("../form-engine");
      await openFormById(player, row.menuId);
      continue;
    }

    if (result.id === "delete") {
      const confirmed = await TauUi.confirm(player, {
        title: "Delete binding?",
        body: `Remove the ${bindingKindLabel(row.kind).toLowerCase()} for "${row.displayKey}" -> "${row.menuId}"?`,
        confirmText: "Delete",
        cancelText: "Cancel",
      });
      if (!confirmed) continue;
      deleteBindingRow(row);
      tell(player, `Removed binding: ${row.displayKey} -> ${row.menuId}.`);
      return "deleted";
    }
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
      .button("claims", `Claims: ${features.claims ? "On" : "Off"}`, { iconPath: ICONS.plot })
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
      lootChests: "lootChests", commandBuilder: "commandBuilder", claims: "claims",
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
      .body(`Enabled: ${prune.enabled ? "On" : "Off"}\nInactive days: ${prune.inactiveDays}\nFlags: stats, profiles, teams, plots, claims, homes, tpa, pay, playerSettings`)
      .button("toggleEnabled", `Enabled: ${prune.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("setInactiveDays", "Set Inactive Days", { iconPath: ICONS.edit })
      .button("stats", `Stats: ${prune.flags.stats ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("profiles", `Profiles: ${prune.flags.profiles ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("teams", `Teams: ${prune.flags.teams ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("plots", `Plots: ${prune.flags.plots ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("claims", `Claims: ${prune.flags.claims ? "On" : "Off"}`, { iconPath: ICONS.plot })
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
      stats: "stats", profiles: "profiles", teams: "teams", plots: "plots", claims: "claims",
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
