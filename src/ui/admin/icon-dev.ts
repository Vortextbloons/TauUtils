import { Player } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS, ICON_DEV_OPTIONS } from "../../types";
import { isOperator, tell } from "../../storage";

export async function showIconDevMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "Operator permissions are required.");
    return;
  }
  while (true) {
    const form = TauUi.action<{ index: number }>("§6Icon Dev§r")
      .body("§7Preview the allowlisted working icons.§r");

    for (let i = 0; i < ICON_DEV_OPTIONS.length; i++) {
      const option = ICON_DEV_OPTIONS[i];
      form.button(String(i), option.label, { iconPath: option.path, value: { index: i } });
    }
    form.button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled) return;
    if (response.id === "back") return;
    if (response.value === undefined) return;

    const option = ICON_DEV_OPTIONS[response.value.index];

    const preview = await TauUi.action(`§6${option.label}§r`)
      .body(`§7Path: §f${option.path ?? "none"}§r`)
      .button("use", "Use This Icon", { iconPath: option.path })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (preview.canceled || preview.id !== "use") continue;
  }
}
