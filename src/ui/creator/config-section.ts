import { Player } from "@minecraft/server";
import { ICONS } from "../../types";
import { TauUi } from "../tau-ui";

export async function showConfigSection(player: Player) {
  while (true) {
    const response = await TauUi.action("Config")
      .button("featureToggles", "Feature Toggles", { iconPath: ICONS.settings })
      .button("socialSettings", "Social Settings", { iconPath: ICONS.menu })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (TauUi.isCanceledOrBack(response)) return;

    if (response.id === "featureToggles") {
      const { showConfigMenu } = await import("../admin-ui");
      await showConfigMenu(player);
      continue;
    }
    if (response.id === "socialSettings") {
      const { showSocialSettingsAdmin } = await import("../social-ui");
      await showSocialSettingsAdmin(player);
      continue;
    }
  }
}
