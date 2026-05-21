import type { ActionType, FormElement } from "../types";
import { ICONS, isWorkingIconPath } from "./icons";

export function iconForAction(action: ActionType): string {
  switch (action) {
    case "COMMAND_PLAYER":
    case "COMMAND_SUDO":
      return ICONS.command;
    case "OPEN_MENU":
      return ICONS.menu;
    case "SHOP_TRANSACTION":
      return ICONS.shop;
    case "CLOSE":
    default:
      return ICONS.cancel;
  }
}

export function iconForElement(kind: FormElement["kind"]): string {
  switch (kind) {
    case "button":
      return ICONS.actionForm;
    case "toggle":
    case "slider":
      return ICONS.settings;
    case "dropdown":
      return ICONS.menu;
    case "input":
      return ICONS.edit;
    case "label":
      return ICONS.menu;
    case "divider":
    default:
      return ICONS.back;
  }
}

export function optionalIcon(iconPath?: string): string | undefined {
  if (!isWorkingIconPath(iconPath)) return undefined;
  return iconPath;
}
