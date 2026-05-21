import { Player, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ACTION_TYPES, ICONS, WORKING_ICON_OPTIONS, isWorkingIconPath, type ActionType, type FormDefinition, type FormElement, type UIButtonElement } from "../types";
import { findForm, getPlayerId, getPlayerRank, getPlayerStats, isFeatureEnabled, isOperator, normalizeKey, saveForms, saveProfiles, saveModeration, state, tell } from "../storage";
import { iconForAction, iconForElement, optionalIcon } from "./tau-ui-helper";
import { TauUi } from "./tau-ui";
import { safeCall } from "../shared/safe-call";

function formLabel(element: FormElement): string {
  switch (element.kind) {
    case "button":
      return `Button: ${element.text}`;
    case "toggle":
      return `Toggle: ${element.label}`;
    case "slider":
      return `Slider: ${element.label}`;
    case "dropdown":
      return `Dropdown: ${element.label}`;
    case "input":
      return `Input: ${element.label}`;
    case "label":
      return `Label: ${element.text}`;
    case "divider":
      return "Divider";
  }
}

function formSummary(element: FormElement): string {
  switch (element.kind) {
    case "button":
      return `${element.action}${element.value ? ` -> ${element.value}` : ""}`;
    case "toggle":
      return `${element.action} ${element.defaultValue ? "on" : "off"}`;
    case "slider":
      return `${element.action} ${element.min}-${element.max}`;
    case "dropdown":
      return `${element.action} ${element.options.length} options`;
    case "input":
      return `${element.action} input`;
    case "label":
      return "static label";
    case "divider":
      return "divider";
  }
}

async function editFormElement(player: Player, form: FormDefinition, index: number) {
  const element = form.elements[index];
  if (!element) return;

  while (true) {
    const submenu = new ActionFormData()
      .title(`Element ${index + 1}: ${formLabel(element)}`)
      .body(formSummary(element))
      .button("Edit", ICONS.edit)
      .button("Move Up", ICONS.back);
    
    if (index >= form.elements.length - 1) {
      submenu.button("Move Down (last)", ICONS.cancel);
    } else {
      submenu.button("Move Down", ICONS.back);
    }

    submenu.button("Delete", ICONS.delete);
    submenu.button("Back", ICONS.back);

    const response = await safeCall(() => submenu.show(player), undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (response.selection === 0) {
      await editElementModal(player, form, index);
      continue;
    }

    if (response.selection === 1) {
      if (index > 0) {
        [form.elements[index - 1], form.elements[index]] = [form.elements[index], form.elements[index - 1]];
        saveForms();
        tell(player, "Element moved up.");
      }
      return;
    }

    if (response.selection === 2) {
      if (index < form.elements.length - 1) {
        [form.elements[index], form.elements[index + 1]] = [form.elements[index + 1], form.elements[index]];
        saveForms();
        tell(player, "Element moved down.");
      }
      return;
    }

    if (response.selection === 3) {
      form.elements.splice(index, 1);
      saveForms();
      tell(player, "Element deleted.");
      return;
    }

    return;
  }
}

async function editElementModal(player: Player, form: FormDefinition, index: number) {
  const element = form.elements[index];
  if (!element) return;

  if (element.kind === "button") {
    const modal = new ModalFormData()
      .title(`Edit Button: ${element.text}`)
      .textField("Text", "Visit Shop", { defaultValue: element.text })
      .dropdown("Icon", WORKING_ICON_OPTIONS.map((option) => option.label), { defaultValueIndex: Math.max(0, WORKING_ICON_OPTIONS.findIndex((option) => option.path === element.iconPath)) })
      .dropdown("Action Type", [...ACTION_TYPES], { defaultValueIndex: ACTION_TYPES.indexOf(element.action) })
      .textField("Value", "", { defaultValue: element.value ?? "" })
      .submitButton("Save");
    const result = await safeCall(() => modal.show(player), undefined);
    if (!result || result.canceled || !result.formValues) return;
    element.text = String(result.formValues[0] ?? "").trim() || element.text;
    const selectedIcon = WORKING_ICON_OPTIONS[Number(result.formValues[1] ?? 0)]?.path;
    element.iconPath = isWorkingIconPath(selectedIcon) ? selectedIcon : undefined;
    element.action = ACTION_TYPES[Number(result.formValues[2] ?? 0)] ?? element.action;
    element.value = String(result.formValues[3] ?? "").trim() || undefined;
    saveForms();
    tell(player, "Button updated.");
    return;
  }

  if (element.kind === "toggle") {
    const modal = new ModalFormData()
      .title(`Edit Toggle: ${element.label}`)
      .textField("Label", "Option", { defaultValue: element.label })
      .toggle("Default value", { defaultValue: element.defaultValue ?? false })
      .dropdown("Action Type", [...ACTION_TYPES], { defaultValueIndex: ACTION_TYPES.indexOf(element.action) })
      .textField("Value", "", { defaultValue: element.value ?? "" })
      .submitButton("Save");
    const result = await safeCall(() => modal.show(player), undefined);
    if (!result || result.canceled || !result.formValues) return;
    element.label = String(result.formValues[0] ?? "").trim() || element.label;
    element.defaultValue = Boolean(result.formValues[1]);
    element.action = ACTION_TYPES[Number(result.formValues[2] ?? 0)] ?? element.action;
    element.value = String(result.formValues[3] ?? "").trim() || undefined;
    saveForms();
    tell(player, "Toggle updated.");
    return;
  }

  if (element.kind === "slider") {
    const modal = new ModalFormData()
      .title(`Edit Slider: ${element.label}`)
      .textField("Label", "Amount", { defaultValue: element.label })
      .textField("Min", "0", { defaultValue: String(element.min) })
      .textField("Max", "100", { defaultValue: String(element.max) })
      .textField("Step", "1", { defaultValue: String(element.step ?? 1) })
      .textField("Default", "50", { defaultValue: String(element.defaultValue ?? 50) })
      .dropdown("Action Type", [...ACTION_TYPES], { defaultValueIndex: ACTION_TYPES.indexOf(element.action) })
      .textField("Value", "", { defaultValue: element.value ?? "" })
      .submitButton("Save");
    const result = await safeCall(() => modal.show(player), undefined);
    if (!result || result.canceled || !result.formValues) return;
    element.label = String(result.formValues[0] ?? "").trim() || element.label;
    element.min = Number(result.formValues[1] ?? element.min);
    element.max = Number(result.formValues[2] ?? element.max);
    element.step = Number(result.formValues[3] ?? element.step ?? 1);
    element.defaultValue = Number(result.formValues[4] ?? element.defaultValue ?? element.min);
    element.action = ACTION_TYPES[Number(result.formValues[5] ?? 0)] ?? element.action;
    element.value = String(result.formValues[6] ?? "").trim() || undefined;
    saveForms();
    tell(player, "Slider updated.");
    return;
  }

  if (element.kind === "dropdown") {
    const modal = new ModalFormData()
      .title(`Edit Dropdown: ${element.label}`)
      .textField("Label", "Choice", { defaultValue: element.label })
      .textField("Options (comma-separated)", "a,b,c", { defaultValue: element.options.join(",") })
      .textField("Default index", "0", { defaultValue: String(element.defaultValueIndex ?? 0) })
      .dropdown("Action Type", [...ACTION_TYPES], { defaultValueIndex: ACTION_TYPES.indexOf(element.action) })
      .textField("Value", "", { defaultValue: element.value ?? "" })
      .submitButton("Save");
    const result = await safeCall(() => modal.show(player), undefined);
    if (!result || result.canceled || !result.formValues) return;
    element.label = String(result.formValues[0] ?? "").trim() || element.label;
    element.options = String(result.formValues[1] ?? "").split(",").map((v) => v.trim()).filter((v) => v.length > 0);
    element.defaultValueIndex = Number(result.formValues[2] ?? element.defaultValueIndex ?? 0);
    element.action = ACTION_TYPES[Number(result.formValues[3] ?? 0)] ?? element.action;
    element.value = String(result.formValues[4] ?? "").trim() || undefined;
    saveForms();
    tell(player, "Dropdown updated.");
    return;
  }

  if (element.kind === "input") {
    const modal = new ModalFormData()
      .title(`Edit Input: ${element.label}`)
      .textField("Label", "Text", { defaultValue: element.label })
      .textField("Placeholder", "Type here", { defaultValue: element.placeholder ?? "" })
      .textField("Default", "", { defaultValue: element.defaultValue ?? "" })
      .dropdown("Action Type", [...ACTION_TYPES], { defaultValueIndex: ACTION_TYPES.indexOf(element.action) })
      .textField("Value", "", { defaultValue: element.value ?? "" })
      .submitButton("Save");
    const result = await safeCall(() => modal.show(player), undefined);
    if (!result || result.canceled || !result.formValues) return;
    element.label = String(result.formValues[0] ?? "").trim() || element.label;
    element.placeholder = String(result.formValues[1] ?? "").trim() || undefined;
    element.defaultValue = String(result.formValues[2] ?? "").trim() || undefined;
    element.action = ACTION_TYPES[Number(result.formValues[3] ?? 0)] ?? element.action;
    element.value = String(result.formValues[4] ?? "").trim() || undefined;
    saveForms();
    tell(player, "Input updated.");
    return;
  }
}

export async function showCreatorMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to use the UI creator.");
    return;
  }
  if (!isFeatureEnabled("creator")) {
    tell(player, "The creator feature is disabled.");
    return;
  }

  while (true) {
    const ids = Object.keys(state.forms);
    const response = await TauUi.action("Creator")
      .body(`Stored forms: ${ids.length}`)
      .button("menuUi", "Menu & UI Management", { iconPath: ICONS.menu })
      .button("playerSystems", "Player Systems", { iconPath: ICONS.rank })
      .button("worldSystems", "World Systems", { iconPath: ICONS.plot })
      .button("adminRules", "Admin / Rules", { iconPath: ICONS.utility })
      .button("config", "Config", { iconPath: ICONS.settings })
      .button("close", "Close", { iconPath: ICONS.cancel })
      .show(player);

    if (response.canceled || response.id === "close") return;

    if (response.id === "menuUi") {
      await showMenuUiManagement(player);
      continue;
    }
    if (response.id === "playerSystems") {
      await showPlayerSystems(player);
      continue;
    }
    if (response.id === "worldSystems") {
      await showWorldSystems(player);
      continue;
    }
    if (response.id === "adminRules") {
      await showAdminRules(player);
      continue;
    }
    if (response.id === "config") {
      await showConfigSection(player);
      continue;
    }
  }
}

async function showMenuUiManagement(player: Player) {
  while (true) {
    const ids = Object.keys(state.forms);
    const response = await TauUi.action("Menu & UI Management")
      .body(`Stored forms: ${ids.length}`)
      .button("createAction", "Create Action Form", { iconPath: ICONS.actionForm })
      .button("createModal", "Create Modal Form", { iconPath: ICONS.modalForm })
      .button("editForm", "Edit Existing Form", { iconPath: ICONS.edit })
      .button("previewForm", "Preview Form", { iconPath: ICONS.menu })
      .button("bindings", "Bindings", { iconPath: ICONS.binding })
      .button("commandBuilder", "Command Builder", { iconPath: ICONS.utility })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (response.canceled || response.id === "back") return;

    if (response.id === "createAction") {
      await showCreateBaseForm(player, "action");
      continue;
    }
    if (response.id === "createModal") {
      await showCreateBaseForm(player, "modal");
      continue;
    }
    if (response.id === "editForm") {
      if (ids.length === 0) {
        tell(player, "No forms exist yet.");
        continue;
      }
      const picker = TauUi.action<string>("Edit Form");
      for (const id of ids) {
        picker.button(id, id, { iconPath: ICONS.edit, value: id });
      }
      picker.button("back", "Back", { iconPath: ICONS.back });
      const pick = await picker.show(player);
      if (pick.canceled || pick.id === "back" || !pick.value) continue;
      await showFormEditor(player, pick.value);
      continue;
    }
    if (response.id === "previewForm") {
      if (ids.length === 0) {
        tell(player, "No forms exist yet.");
        continue;
      }
      const picker = TauUi.action<string>("Preview Form");
      for (const id of ids) {
        picker.button(id, id, { iconPath: ICONS.menu, value: id });
      }
      picker.button("back", "Back", { iconPath: ICONS.back });
      const pick = await picker.show(player);
      if (pick.canceled || pick.id === "back" || !pick.value) continue;
      const { openFormById } = await import("./form-engine");
      await openFormById(player, pick.value);
      continue;
    }
    if (response.id === "bindings") {
      const { showBindingsEditor } = await import("./admin-ui");
      await showBindingsEditor(player);
      continue;
    }
    if (response.id === "commandBuilder") {
      const { showCommandBuilderMenu } = await import("./command-builder-ui");
      await showCommandBuilderMenu(player);
      continue;
    }
  }
}

async function showPlayerSystems(player: Player) {
  while (true) {
    const response = await TauUi.action("Player Systems")
      .button("shopProfiles", "Shop Profiles", { iconPath: ICONS.shop })
      .button("playerShopAdmin", "Player Shop Admin", { iconPath: ICONS.settings })
      .button("sidebar", "Sidebar Customizer", { iconPath: ICONS.sidebar })
      .button("ranks", "Ranks", { iconPath: ICONS.rank })
      .button("profiles", "Profiles", { iconPath: ICONS.menu })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (response.canceled || response.id === "back") return;

    if (response.id === "shopProfiles") {
      const { showShopProfilesEditor } = await import("../shop");
      await showShopProfilesEditor(player);
      continue;
    }
    if (response.id === "playerShopAdmin") {
      const { openPlayerShopAdmin } = await import("../player-shops");
      await openPlayerShopAdmin(player);
      continue;
    }
    if (response.id === "sidebar") {
      const { showSidebarEditor } = await import("../sidebar");
      await showSidebarEditor(player);
      continue;
    }
    if (response.id === "ranks") {
      const { showRankManager } = await import("./ranks-ui");
      await showRankManager(player);
      continue;
    }
    if (response.id === "profiles") {
      const { showProfileBrowser } = await import("./ranks-ui");
      await showProfileBrowser(player);
      continue;
    }
  }
}

async function showWorldSystems(player: Player) {
  while (true) {
    const response = await TauUi.action("World Systems")
      .button("plots", "Plots", { iconPath: ICONS.plot })
      .button("customAreas", "Custom Areas", { iconPath: ICONS.sidebar })
      .button("lootChests", "Loot Chests", { iconPath: ICONS.item })
      .button("generators", "Generators", { iconPath: ICONS.shop })
      .button("crates", "Crates", { iconPath: ICONS.shop })
      .button("prune", "Prune Data", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (response.canceled || response.id === "back") return;

    if (response.id === "plots") {
      const { showPlotManager } = await import("./plots-ui");
      await showPlotManager(player);
      continue;
    }
    if (response.id === "customAreas") {
      const { showCustomAreasAdminMenu } = await import("./custom-areas-ui");
      await showCustomAreasAdminMenu(player);
      continue;
    }
    if (response.id === "lootChests") {
      const { showLootChestsAdminMenu } = await import("./loot-chests-ui");
      await showLootChestsAdminMenu(player);
      continue;
    }
    if (response.id === "generators") {
      const { showGeneratorAdminMenu } = await import("./admin-ui");
      await showGeneratorAdminMenu(player);
      continue;
    }
    if (response.id === "crates") {
      const { showCrateAdminMenu } = await import("./admin-ui");
      await showCrateAdminMenu(player);
      continue;
    }
    if (response.id === "prune") {
      const { showPruneDataMenu } = await import("./admin-ui");
      await showPruneDataMenu(player);
      continue;
    }
  }
}

async function showAdminRules(player: Player) {
  while (true) {
    const response = await TauUi.action("Admin / Rules")
      .button("combat", "Combat Settings", { iconPath: ICONS.settings })
      .button("moderation", "Moderation", { iconPath: ICONS.utility })
      .button("tauItems", "TauItems", { iconPath: ICONS.item })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (response.canceled || response.id === "back") return;

    if (response.id === "combat") {
      const { showCombatSettingsAdmin } = await import("./social-ui");
      await showCombatSettingsAdmin(player);
      continue;
    }
    if (response.id === "moderation") {
      const { showModerationMenu } = await import("./admin-ui");
      await showModerationMenu(player);
      continue;
    }
    if (response.id === "tauItems") {
      const { showTauItemsAdminMenu } = await import("./admin-ui");
      await showTauItemsAdminMenu(player);
      continue;
    }
  }
}

async function showConfigSection(player: Player) {
  while (true) {
    const response = await TauUi.action("Config")
      .button("featureToggles", "Feature Toggles", { iconPath: ICONS.settings })
      .button("socialSettings", "Social Settings", { iconPath: ICONS.menu })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (response.canceled || response.id === "back") return;

    if (response.id === "featureToggles") {
      const { showConfigMenu } = await import("./admin-ui");
      await showConfigMenu(player);
      continue;
    }
    if (response.id === "socialSettings") {
      const { showSocialSettingsAdmin } = await import("./social-ui");
      await showSocialSettingsAdmin(player);
      continue;
    }
  }
}

async function showCreateBaseForm(player: Player, layout: "action" | "modal") {
  const modal = new ModalFormData()
    .title(`Create ${layout === "action" ? "Action" : "Modal"} Form`)
    .textField("Form ID", "example: main_menu")
    .textField("Title", "Server Hub")
    .textField("Body (optional)", "Text shown below title")
    .submitButton("Create");

    const response = await safeCall(() => modal.show(player), undefined);
  if (!response || response.canceled || !response.formValues) return;

  const id = String(response.formValues[0] ?? "").trim();
  const title = String(response.formValues[1] ?? "").trim();
  const body = String(response.formValues[2] ?? "").trim();

  if (!id.match(/^[a-zA-Z0-9_:-]+$/)) {
    tell(player, "Invalid form id. Use letters, numbers, _, :, or -.");
    return;
  }
  if (!title) {
    tell(player, "Form title is required.");
    return;
  }

  state.forms[id] = {
    id,
    title,
    body: body || undefined,
    layout,
    elements: [],
  };
  saveForms();
  tell(player, `Created form "${id}".`);
  await showFormEditor(player, id);
}

async function showActionButtonCreator(player: Player, form: FormDefinition) {
  const modal = new ModalFormData()
    .title(`Add Button: ${form.id}`)
    .textField("Button text", "Visit Shop")
    .dropdown("Icon", WORKING_ICON_OPTIONS.map((option) => option.label), { defaultValueIndex: 0 })
    .dropdown("Action Type", [...ACTION_TYPES])
    .textField("Value", "menu id, command, or shop token")
    .submitButton("Add");

    const response = await safeCall(() => modal.show(player), undefined);
  if (!response || response.canceled || !response.formValues) return;

  const text = String(response.formValues[0] ?? "").trim();
  const iconIndex = Number(response.formValues[1] ?? 0);
  const iconPath = WORKING_ICON_OPTIONS[iconIndex]?.path;
  const actionIndex = Number(response.formValues[2] ?? 0);
  const value = String(response.formValues[3] ?? "").trim();

  if (!text) {
    tell(player, "Button text cannot be empty.");
    return;
  }

  form.elements.push({
    kind: "button",
    text,
    iconPath: isWorkingIconPath(iconPath) ? iconPath : undefined,
    action: ACTION_TYPES[actionIndex] ?? ACTION_TYPES[0],
    value: value || undefined,
  });
  saveForms();
  tell(player, `Added button "${text}".`);
}

async function showModalElementCreator(player: Player, form: FormDefinition) {
  const pickType = await new ActionFormData()
    .title(`Add Element: ${form.id}`)
    .button("Toggle", ICONS.settings)
    .button("Slider", ICONS.settings)
    .button("Dropdown", ICONS.menu)
    .button("Input", ICONS.edit)
    .button("Label", ICONS.menu)
    .button("Divider", ICONS.back)
    .button("Cancel", ICONS.cancel)
    .show(player)
    .catch(() => undefined);

  if (!pickType || pickType.canceled || pickType.selection === undefined) return;
  if (pickType.selection === 6) return;

  if (pickType.selection === 4) {
    const labelForm = new ModalFormData()
      .title("Add Label")
      .textField("Text", "Section Title")
      .submitButton("Add");
    const response = await safeCall(() => labelForm.show(player), undefined);
    if (!response || response.canceled || !response.formValues) return;
    const text = String(response.formValues[0] ?? "").trim();
    if (!text) return;
    form.elements.push({ kind: "label", text });
    saveForms();
    tell(player, "Label added.");
    return;
  }

  if (pickType.selection === 5) {
    form.elements.push({ kind: "divider" });
    saveForms();
    tell(player, "Divider added.");
    return;
  }

  const base = new ModalFormData()
    .title("Bind Element")
    .textField("Label", "Field label")
    .dropdown("Action Type", [...ACTION_TYPES])
    .textField("Value", "command/menu/shop token")
    .submitButton("Continue");

  const baseResponse = await safeCall(() => base.show(player), undefined);
  if (!baseResponse || baseResponse.canceled || !baseResponse.formValues) return;

  const label = String(baseResponse.formValues[0] ?? "").trim();
  const actionType = ACTION_TYPES[Number(baseResponse.formValues[1] ?? 0)] ?? ACTION_TYPES[0];
  const value = String(baseResponse.formValues[2] ?? "").trim();

  if (!label) {
    tell(player, "Label is required.");
    return;
  }

  if (pickType.selection === 0) {
    const details = new ModalFormData()
      .title("Toggle Options")
      .toggle("Default enabled", { defaultValue: false })
      .submitButton("Add");
    const response = await safeCall(() => details.show(player), undefined);
    if (!response || response.canceled || !response.formValues) return;
    form.elements.push({
      kind: "toggle",
      label,
      defaultValue: Boolean(response.formValues[0] ?? false),
      action: actionType,
      value: value || undefined,
    });
  } else if (pickType.selection === 1) {
    const details = new ModalFormData()
      .title("Slider Options")
      .textField("Min", "0", { defaultValue: "0" })
      .textField("Max", "100", { defaultValue: "100" })
      .textField("Step", "1", { defaultValue: "1" })
      .textField("Default", "50", { defaultValue: "50" })
      .submitButton("Add");
    const response = await safeCall(() => details.show(player), undefined);
    if (!response || response.canceled || !response.formValues) return;
    const min = Number(response.formValues[0] ?? 0);
    const max = Number(response.formValues[1] ?? 100);
    const step = Number(response.formValues[2] ?? 1);
    const defaultValue = Number(response.formValues[3] ?? 50);
    form.elements.push({
      kind: "slider",
      label,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 100,
      step: Number.isFinite(step) ? step : 1,
      defaultValue: Number.isFinite(defaultValue) ? defaultValue : 50,
      action: actionType,
      value: value || undefined,
    });
  } else if (pickType.selection === 2) {
    const details = new ModalFormData()
      .title("Dropdown Options")
      .textField("Options (comma-separated)", "a,b,c")
      .textField("Default index", "0", { defaultValue: "0" })
      .submitButton("Add");
    const response = await safeCall(() => details.show(player), undefined);
    if (!response || response.canceled || !response.formValues) return;
    const options = String(response.formValues[0] ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (options.length === 0) {
      tell(player, "Dropdown needs at least one option.");
      return;
    }
    const defaultValueIndex = Number(response.formValues[1] ?? 0);
    form.elements.push({
      kind: "dropdown",
      label,
      options,
      defaultValueIndex: Number.isFinite(defaultValueIndex) ? defaultValueIndex : 0,
      action: actionType,
      value: value || undefined,
    });
  } else if (pickType.selection === 3) {
    const details = new ModalFormData()
      .title("Input Options")
      .textField("Placeholder", "Type here")
      .textField("Default value", "")
      .submitButton("Add");
    const response = await safeCall(() => details.show(player), undefined);
    if (!response || response.canceled || !response.formValues) return;
    const placeholder = String(response.formValues[0] ?? "").trim();
    const defaultValue = String(response.formValues[1] ?? "").trim();
    form.elements.push({
      kind: "input",
      label,
      placeholder: placeholder || undefined,
      defaultValue: defaultValue || undefined,
      action: actionType,
      value: value || undefined,
    });
  }

  saveForms();
  tell(player, "Element added.");
}

function describeElement(element: FormElement): string {
  switch (element.kind) {
    case "button":
      return `[BTN] ${element.text} -> ${element.action}`;
    case "toggle":
      return `[TOGGLE] ${element.label} -> ${element.action}`;
    case "slider":
      return `[SLIDER] ${element.label} -> ${element.action}`;
    case "dropdown":
      return `[DROPDOWN] ${element.label} -> ${element.action}`;
    case "input":
      return `[INPUT] ${element.label} -> ${element.action}`;
    case "label":
      return `[LABEL] ${element.text}`;
    case "divider":
      return "[DIVIDER]";
  }
}

async function showFormEditor(player: Player, formId: string) {
  const form = state.forms[formId];
  if (!form) return;

  while (true) {
    const editor = new ActionFormData()
      .title(`Editing: ${form.id}`)
      .body(`Layout: ${form.layout}\nElements: ${form.elements.length}`)
      .button("Add element", ICONS.confirm)
      .button("Preview form", ICONS.menu)
      .button("Delete form", ICONS.delete)
      .button("Back", ICONS.back);

    for (const [index, element] of form.elements.entries()) {
      editor.button(`${index + 1}. ${describeElement(element)}\n${formSummary(element)}`, iconForElement(element.kind));
    }

    const response = await safeCall(() => editor.show(player), undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (response.selection === 0) {
      if (form.layout === "action") {
        await showActionButtonCreator(player, form);
      } else {
        await showModalElementCreator(player, form);
      }
      continue;
    }

    if (response.selection === 1) {
      const { openFormById } = await import("./form-engine");
      await openFormById(player, form.id);
      continue;
    }

    if (response.selection === 2) {
      delete state.forms[form.id];
      saveForms();
      tell(player, `Deleted form "${form.id}".`);
      return;
    }

    if (response.selection === 3) {
      return;
    }

    const elementIndex = response.selection - 4;
    if (elementIndex >= 0 && elementIndex < form.elements.length) {
      await editFormElement(player, form, elementIndex);
      continue;
    }
  }
}


