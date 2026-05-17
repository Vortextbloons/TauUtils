import { Player, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ACTION_TYPES, isWorkingIconPath, ICONS, type ActionType, type FormDefinition, type FormElement, type UIButtonElement } from "../types";
import { findForm, sanitizePlayerCommand, commandStripSlash, normalizeForSudo, state, isFeatureEnabled, tell } from "../storage";
import { runBuiltCommandFromConfiguredCommand } from "../command-builder";
import { iconForAction, iconForElement, optionalIcon } from "./tau-ui-helper";

export async function openFormById(player: Player, menuId: string) {
  const form = findForm(menuId);
  if (!form) {
    tell(player, `Menu "${menuId}" was not found.`);
    return;
  }

  if (form.layout === "action") {
    const buttons = form.elements.filter(
      (element): element is UIButtonElement => element.kind === "button"
    );

    const actionForm = new ActionFormData().title(form.title);
    if (form.body) actionForm.body(form.body);
    for (const button of buttons) {
      const icon = optionalIcon(button.iconPath) ?? undefined;
      if (icon) actionForm.button(button.text, icon);
      else actionForm.button(button.text);
    }
    if (buttons.length === 0) {
      actionForm.button("Close", ICONS.cancel);
    }

    const response = await actionForm.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined)
      return;
    const selected = buttons[response.selection];
    if (!selected) return;
    await runBoundAction(player, selected.action, selected.value);
    return;
  }

  const modalForm = new ModalFormData().title(form.title).submitButton("Submit");
  const handlers: { action: ActionType; value?: string }[] = [];

  for (const element of form.elements) {
    switch (element.kind) {
      case "toggle":
        modalForm.toggle(element.label, {
          defaultValue: element.defaultValue ?? false,
        });
        handlers.push({ action: element.action, value: element.value });
        break;
      case "slider":
        modalForm.slider(element.label, element.min, element.max, {
          defaultValue: element.defaultValue,
          valueStep: element.step,
        });
        handlers.push({ action: element.action, value: element.value });
        break;
      case "dropdown":
        modalForm.dropdown(element.label, element.options, {
          defaultValueIndex: element.defaultValueIndex,
        });
        handlers.push({ action: element.action, value: element.value });
        break;
      case "input":
        modalForm.textField(element.label, element.placeholder ?? "", {
          defaultValue: element.defaultValue,
        });
        handlers.push({ action: element.action, value: element.value });
        break;
      case "label":
        modalForm.label(element.text);
        break;
      case "divider":
        modalForm.divider();
        break;
      case "button":
        break;
    }
  }

  const response = await modalForm.show(player).catch(() => undefined);
  if (!response || response.canceled || !response.formValues) return;

  for (let i = 0; i < handlers.length; i++) {
    const handler = handlers[i];
    const selectedValue = response.formValues[i];
    const shouldExecute =
      typeof selectedValue === "boolean"
        ? selectedValue
        : selectedValue !== undefined && String(selectedValue).length > 0;
    if (!shouldExecute && handler.action !== "CLOSE") continue;
    await runBoundAction(player, handler.action, handler.value, selectedValue);
  }
}

async function runBoundAction(
  player: Player,
  action: ActionType,
  rawValue: string | undefined,
  selectedValue?: unknown
) {
  const { ItemStack, Player } = await import("@minecraft/server");
  const { openShopTransaction } = await import("../shop");
  const { sanitizePlayerCommand, commandStripSlash, normalizeForSudo } = await import("../storage");
  const { renderTemplate } = await import("../shared/templates");

  const value = renderTemplate(rawValue, {
    player,
    extra: { value: selectedValue === undefined ? "" : String(selectedValue) },
  }).trim();
  try {
    switch (action) {
      case "COMMAND_PLAYER": {
        if (!value) return;
        if (!sanitizePlayerCommand(value)) {
          tell(player, "That player command is blocked by sanitization policy.");
          return;
        }
        if (runBuiltCommandFromConfiguredCommand(player, value)) return;
        player.runCommand(commandStripSlash(value));
        return;
      }
      case "COMMAND_SUDO": {
        if (!value) return;
        if (runBuiltCommandFromConfiguredCommand(player, value)) return;
        player.dimension.runCommand(commandStripSlash(normalizeForSudo(value, player)));
        return;
      }
      case "OPEN_MENU": {
        if (!value) return;
        await openFormById(player, value);
        return;
      }
      case "SHOP_TRANSACTION": {
        if (!value) return;
        await openShopTransaction(player, value);
        return;
      }
      case "CLOSE":
      default:
        return;
    }
  } catch (error) {
    tell(player, `Action ${action} failed: ${String(error)}`);
  }
}
