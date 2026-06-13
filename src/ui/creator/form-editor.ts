import { Player } from "@minecraft/server";
import { ACTION_TYPES, ICONS, WORKING_ICON_OPTIONS, isWorkingIconPath, type FormDefinition, type FormElement } from "../../types";
import { saveForms, state, tell } from "../../storage";
import { iconForElement } from "../tau-ui-helper";
import { TauUi } from "../tau-ui";

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
    const submenu = TauUi.action(`Element ${index + 1}: ${formLabel(element)}`)
      .body(formSummary(element))
      .button("edit", "Edit", { iconPath: ICONS.edit })
      .button("moveUp", index > 0 ? "Move Up" : "Move Up (first)", { iconPath: ICONS.back })
      .button("moveDown", index < form.elements.length - 1 ? "Move Down" : "Move Down (last)", { iconPath: ICONS.back })
      .button("delete", "Delete", { iconPath: ICONS.delete })
      .back("Back", ICONS.back);

    const response = await submenu.show(player);
    if (TauUi.isCanceledOrBack(response)) return;

    if (response.id === "edit") {
      await editElementModal(player, form, index);
      continue;
    }

    if (response.id === "moveUp") {
      if (index > 0) {
        [form.elements[index - 1], form.elements[index]] = [form.elements[index], form.elements[index - 1]];
        saveForms();
        tell(player, "Element moved up.");
      }
      return;
    }

    if (response.id === "moveDown") {
      if (index < form.elements.length - 1) {
        [form.elements[index], form.elements[index + 1]] = [form.elements[index + 1], form.elements[index]];
        saveForms();
        tell(player, "Element moved down.");
      }
      return;
    }

    if (response.id === "delete") {
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
    const modal = TauUi.modal(`Edit Button: ${element.text}`)
      .text("text", "Text", { placeholder: "Visit Shop", defaultValue: element.text })
      .dropdown("icon", "Icon", WORKING_ICON_OPTIONS.map((option) => option.label), Math.max(0, WORKING_ICON_OPTIONS.findIndex((option) => option.path === element.iconPath)))
      .dropdown("actionType", "Action Type", [...ACTION_TYPES], ACTION_TYPES.indexOf(element.action))
      .text("value", "Value", { defaultValue: element.value ?? "" })
      .submitButton("Save");
    const result = await modal.show(player);
    if (result.canceled) return;
    element.text = String(result.values.text ?? "").trim() || element.text;
    const selectedIcon = WORKING_ICON_OPTIONS[Number(result.values.icon ?? 0)]?.path;
    element.iconPath = isWorkingIconPath(selectedIcon) ? selectedIcon : undefined;
    element.action = ACTION_TYPES[Number(result.values.actionType ?? 0)] ?? element.action;
    element.value = String(result.values.value ?? "").trim() || undefined;
    saveForms();
    tell(player, "Button updated.");
    return;
  }

  if (element.kind === "toggle") {
    const modal = TauUi.modal(`Edit Toggle: ${element.label}`)
      .text("label", "Label", { placeholder: "Option", defaultValue: element.label })
      .toggle("defaultValue", "Default value", element.defaultValue ?? false)
      .dropdown("actionType", "Action Type", [...ACTION_TYPES], ACTION_TYPES.indexOf(element.action))
      .text("value", "Value", { defaultValue: element.value ?? "" })
      .submitButton("Save");
    const result = await modal.show(player);
    if (result.canceled) return;
    element.label = String(result.values.label ?? "").trim() || element.label;
    element.defaultValue = Boolean(result.values.defaultValue);
    element.action = ACTION_TYPES[Number(result.values.actionType ?? 0)] ?? element.action;
    element.value = String(result.values.value ?? "").trim() || undefined;
    saveForms();
    tell(player, "Toggle updated.");
    return;
  }

  if (element.kind === "slider") {
    const modal = TauUi.modal(`Edit Slider: ${element.label}`)
      .text("label", "Label", { placeholder: "Amount", defaultValue: element.label })
      .text("min", "Min", { placeholder: "0", defaultValue: String(element.min) })
      .text("max", "Max", { placeholder: "100", defaultValue: String(element.max) })
      .text("step", "Step", { placeholder: "1", defaultValue: String(element.step ?? 1) })
      .text("defaultValue", "Default", { placeholder: "50", defaultValue: String(element.defaultValue ?? 50) })
      .dropdown("actionType", "Action Type", [...ACTION_TYPES], ACTION_TYPES.indexOf(element.action))
      .text("value", "Value", { defaultValue: element.value ?? "" })
      .submitButton("Save");
    const result = await modal.show(player);
    if (result.canceled) return;
    element.label = String(result.values.label ?? "").trim() || element.label;
    element.min = Number(result.values.min ?? element.min);
    element.max = Number(result.values.max ?? element.max);
    element.step = Number(result.values.step ?? element.step ?? 1);
    element.defaultValue = Number(result.values.defaultValue ?? element.defaultValue ?? element.min);
    element.action = ACTION_TYPES[Number(result.values.actionType ?? 0)] ?? element.action;
    element.value = String(result.values.value ?? "").trim() || undefined;
    saveForms();
    tell(player, "Slider updated.");
    return;
  }

  if (element.kind === "dropdown") {
    const modal = TauUi.modal(`Edit Dropdown: ${element.label}`)
      .text("label", "Label", { placeholder: "Choice", defaultValue: element.label })
      .text("options", "Options (comma-separated)", { placeholder: "a,b,c", defaultValue: element.options.join(",") })
      .text("defaultIndex", "Default index", { placeholder: "0", defaultValue: String(element.defaultValueIndex ?? 0) })
      .dropdown("actionType", "Action Type", [...ACTION_TYPES], ACTION_TYPES.indexOf(element.action))
      .text("value", "Value", { defaultValue: element.value ?? "" })
      .submitButton("Save");
    const result = await modal.show(player);
    if (result.canceled) return;
    element.label = String(result.values.label ?? "").trim() || element.label;
    element.options = String(result.values.options ?? "").split(",").map((v) => v.trim()).filter((v) => v.length > 0);
    element.defaultValueIndex = Number(result.values.defaultIndex ?? element.defaultValueIndex ?? 0);
    element.action = ACTION_TYPES[Number(result.values.actionType ?? 0)] ?? element.action;
    element.value = String(result.values.value ?? "").trim() || undefined;
    saveForms();
    tell(player, "Dropdown updated.");
    return;
  }

  if (element.kind === "input") {
    const modal = TauUi.modal(`Edit Input: ${element.label}`)
      .text("label", "Label", { placeholder: "Text", defaultValue: element.label })
      .text("placeholder", "Placeholder", { placeholder: "Type here", defaultValue: element.placeholder ?? "" })
      .text("defaultValue", "Default", { defaultValue: element.defaultValue ?? "" })
      .dropdown("actionType", "Action Type", [...ACTION_TYPES], ACTION_TYPES.indexOf(element.action))
      .text("value", "Value", { defaultValue: element.value ?? "" })
      .submitButton("Save");
    const result = await modal.show(player);
    if (result.canceled) return;
    element.label = String(result.values.label ?? "").trim() || element.label;
    element.placeholder = String(result.values.placeholder ?? "").trim() || undefined;
    element.defaultValue = String(result.values.defaultValue ?? "").trim() || undefined;
    element.action = ACTION_TYPES[Number(result.values.actionType ?? 0)] ?? element.action;
    element.value = String(result.values.value ?? "").trim() || undefined;
    saveForms();
    tell(player, "Input updated.");
    return;
  }
}

export async function showCreateBaseForm(player: Player, layout: "action" | "modal") {
  const modal = TauUi.modal(`Create ${layout === "action" ? "Action" : "Modal"} Form`)
    .text("id", "Form ID", { placeholder: "example: main_menu" })
    .text("title", "Title", { placeholder: "Server Hub" })
    .text("body", "Body (optional)", { placeholder: "Text shown below title" })
    .submitButton("Create");

  const response = await modal.show(player);
  if (response.canceled) return;

  const id = String(response.values.id ?? "").trim();
  const title = String(response.values.title ?? "").trim();
  const body = String(response.values.body ?? "").trim();

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
  const modal = TauUi.modal(`Add Button: ${form.id}`)
    .text("text", "Button text", { placeholder: "Visit Shop" })
    .dropdown("icon", "Icon", WORKING_ICON_OPTIONS.map((option) => option.label), 0)
    .dropdown("actionType", "Action Type", [...ACTION_TYPES])
    .text("value", "Value", { placeholder: "menu id, command, or shop token" })
    .submitButton("Add");

  const response = await modal.show(player);
  if (response.canceled) return;

  const text = String(response.values.text ?? "").trim();
  const iconIndex = Number(response.values.icon ?? 0);
  const iconPath = WORKING_ICON_OPTIONS[iconIndex]?.path;
  const actionIndex = Number(response.values.actionType ?? 0);
  const value = String(response.values.value ?? "").trim();

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

type ElementKind = "toggle" | "slider" | "dropdown" | "input" | "label" | "divider" | "cancel";

async function showModalElementCreator(player: Player, form: FormDefinition) {
  const pickType = await TauUi.action<{ kind: ElementKind }>(`Add Element: ${form.id}`)
    .button("toggle", "Toggle", { iconPath: ICONS.settings, value: { kind: "toggle" } })
    .button("slider", "Slider", { iconPath: ICONS.settings, value: { kind: "slider" } })
    .button("dropdown", "Dropdown", { iconPath: ICONS.menu, value: { kind: "dropdown" } })
    .button("input", "Input", { iconPath: ICONS.edit, value: { kind: "input" } })
    .button("label", "Label", { iconPath: ICONS.menu, value: { kind: "label" } })
    .button("divider", "Divider", { iconPath: ICONS.back, value: { kind: "divider" } })
    .button("cancel", "Cancel", { iconPath: ICONS.cancel, value: { kind: "cancel" } })
    .show(player);

  if (pickType.canceled) return;
  const kind = pickType.value?.kind;
  if (!kind || kind === "cancel") return;

  if (kind === "label") {
    const labelForm = TauUi.modal("Add Label")
      .text("text", "Text", { placeholder: "Section Title" })
      .submitButton("Add");
    const response = await labelForm.show(player);
    if (response.canceled) return;
    const text = String(response.values.text ?? "").trim();
    if (!text) return;
    form.elements.push({ kind: "label", text });
    saveForms();
    tell(player, "Label added.");
    return;
  }

  if (kind === "divider") {
    form.elements.push({ kind: "divider" });
    saveForms();
    tell(player, "Divider added.");
    return;
  }

  const base = TauUi.modal("Bind Element")
    .text("label", "Label", { placeholder: "Field label" })
    .dropdown("actionType", "Action Type", [...ACTION_TYPES])
    .text("value", "Value", { placeholder: "command/menu/shop token" })
    .submitButton("Continue");

  const baseResponse = await base.show(player);
  if (baseResponse.canceled) return;

  const label = String(baseResponse.values.label ?? "").trim();
  const actionType = ACTION_TYPES[Number(baseResponse.values.actionType ?? 0)] ?? ACTION_TYPES[0];
  const value = String(baseResponse.values.value ?? "").trim();

  if (!label) {
    tell(player, "Label is required.");
    return;
  }

  if (kind === "toggle") {
    const details = TauUi.modal("Toggle Options")
      .toggle("defaultValue", "Default enabled", false)
      .submitButton("Add");
    const response = await details.show(player);
    if (response.canceled) return;
    form.elements.push({
      kind: "toggle",
      label,
      defaultValue: Boolean(response.values.defaultValue ?? false),
      action: actionType,
      value: value || undefined,
    });
  } else if (kind === "slider") {
    const details = TauUi.modal("Slider Options")
      .text("min", "Min", { placeholder: "0", defaultValue: "0" })
      .text("max", "Max", { placeholder: "100", defaultValue: "100" })
      .text("step", "Step", { placeholder: "1", defaultValue: "1" })
      .text("defaultValue", "Default", { placeholder: "50", defaultValue: "50" })
      .submitButton("Add");
    const response = await details.show(player);
    if (response.canceled) return;
    const min = Number(response.values.min ?? 0);
    const max = Number(response.values.max ?? 100);
    const step = Number(response.values.step ?? 1);
    const defaultValue = Number(response.values.defaultValue ?? 50);
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
  } else if (kind === "dropdown") {
    const details = TauUi.modal("Dropdown Options")
      .text("options", "Options (comma-separated)", { placeholder: "a,b,c" })
      .text("defaultIndex", "Default index", { placeholder: "0", defaultValue: "0" })
      .submitButton("Add");
    const response = await details.show(player);
    if (response.canceled) return;
    const options = String(response.values.options ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (options.length === 0) {
      tell(player, "Dropdown needs at least one option.");
      return;
    }
    const defaultValueIndex = Number(response.values.defaultIndex ?? 0);
    form.elements.push({
      kind: "dropdown",
      label,
      options,
      defaultValueIndex: Number.isFinite(defaultValueIndex) ? defaultValueIndex : 0,
      action: actionType,
      value: value || undefined,
    });
  } else if (kind === "input") {
    const details = TauUi.modal("Input Options")
      .text("placeholder", "Placeholder", { placeholder: "Type here" })
      .text("defaultValue", "Default value", { defaultValue: "" })
      .submitButton("Add");
    const response = await details.show(player);
    if (response.canceled) return;
    const placeholder = String(response.values.placeholder ?? "").trim();
    const defaultValue = String(response.values.defaultValue ?? "").trim();
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

export async function showFormEditor(player: Player, formId: string) {
  const form = state.forms[formId];
  if (!form) return;

  while (true) {
    const editor = TauUi.action<{ index: number }>(`Editing: ${form.id}`)
      .body(`Layout: ${form.layout}\nElements: ${form.elements.length}`)
      .button("addElement", "Add element", { iconPath: ICONS.confirm })
      .button("preview", "Preview form", { iconPath: ICONS.menu })
      .button("deleteForm", "Delete form", { iconPath: ICONS.delete })
      .back("Back", ICONS.back);

    for (const [index, element] of form.elements.entries()) {
      editor.button("element", `${index + 1}. ${describeElement(element)}\n${formSummary(element)}`, {
        iconPath: iconForElement(element.kind),
        value: { index },
      });
    }

    const response = await editor.show(player);
    if (TauUi.isCanceledOrBack(response)) return;

    if (response.id === "addElement") {
      if (form.layout === "action") {
        await showActionButtonCreator(player, form);
      } else {
        await showModalElementCreator(player, form);
      }
      continue;
    }

    if (response.id === "preview") {
      const { openFormById } = await import("../form-engine");
      await openFormById(player, form.id);
      continue;
    }

    if (response.id === "deleteForm") {
      delete state.forms[form.id];
      saveForms();
      tell(player, `Deleted form "${form.id}".`);
      return;
    }

    if (response.id === "element") {
      const elementIndex = response.value?.index;
      if (elementIndex !== undefined && elementIndex >= 0 && elementIndex < form.elements.length) {
        await editFormElement(player, form, elementIndex);
        continue;
      }
    }
  }
}
