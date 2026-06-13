import { Player } from "@minecraft/server";
import { ICONS } from "../../types";
import { isFeatureEnabled, isOperator, state, tell } from "../../storage";
import { TauUi } from "../tau-ui";
import { showConfigSection } from "./config-section";
import { showCreateBaseForm, showFormEditor } from "./form-editor";

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
      .button("viewBindings", "View Bindings", { iconPath: ICONS.binding })
      .button("commandBuilder", "Command Builder", { iconPath: ICONS.utility })
      .button("iconDev", "Icon Dev", { iconPath: ICONS.menu })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (TauUi.isCanceledOrBack(response)) return;

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
      if (TauUi.isCanceledOrBack(pick) || !pick.value) continue;
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
      if (TauUi.isCanceledOrBack(pick) || !pick.value) continue;
      const { openFormById } = await import("../form-engine");
      await openFormById(player, pick.value);
      continue;
    }
    if (response.id === "bindings") {
      const { showBindingsEditor } = await import("../admin-ui");
      await showBindingsEditor(player);
      continue;
    }
    if (response.id === "viewBindings") {
      const { showBindingsViewer } = await import("../admin-ui");
      await showBindingsViewer(player);
      continue;
    }
    if (response.id === "commandBuilder") {
      const { showCommandBuilderMenu } = await import("../command-builder-ui");
      await showCommandBuilderMenu(player);
      continue;
    }
    if (response.id === "iconDev") {
      const { showIconDevMenu } = await import("../admin-ui");
      await showIconDevMenu(player);
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
      .button("referrals", "Referrals", { iconPath: ICONS.rank })
      .button("customRewards", "Custom Rewards", { iconPath: ICONS.utility })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (TauUi.isCanceledOrBack(response)) return;

    if (response.id === "shopProfiles") {
      const { showShopProfilesEditor } = await import("../../shop");
      await showShopProfilesEditor(player);
      continue;
    }
    if (response.id === "playerShopAdmin") {
      const { openPlayerShopAdmin } = await import("../../player-shops");
      await openPlayerShopAdmin(player);
      continue;
    }
    if (response.id === "sidebar") {
      const { showSidebarEditor } = await import("../../sidebar");
      await showSidebarEditor(player);
      continue;
    }
    if (response.id === "ranks") {
      const { showRankManager } = await import("../ranks-ui");
      await showRankManager(player);
      continue;
    }
    if (response.id === "profiles") {
      const { showProfileBrowser } = await import("../ranks-ui");
      await showProfileBrowser(player);
      continue;
    }
    if (response.id === "referrals") {
      const { showReferralAdminMenu } = await import("../referrals-ui");
      await showReferralAdminMenu(player);
      continue;
    }
    if (response.id === "customRewards") {
      const { showCustomRewardsAdminMenu } = await import("../custom-rewards-ui");
      await showCustomRewardsAdminMenu(player);
      continue;
    }
  }
}

async function showWorldSystems(player: Player) {
  while (true) {
    const response = await TauUi.action("World Systems")
      .button("plots", "Plots", { iconPath: ICONS.plot })
      .button("claims", "Claims", { iconPath: ICONS.plot })
      .button("rtp", "RTP", { iconPath: ICONS.sidebar })
      .button("customAreas", "Custom Areas", { iconPath: ICONS.sidebar })
      .button("lootChests", "Loot Chests", { iconPath: ICONS.item })
      .button("generators", "Generators", { iconPath: ICONS.shop })
      .button("crates", "Crates", { iconPath: ICONS.shop })
      .button("prune", "Prune Data", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (TauUi.isCanceledOrBack(response)) return;

    if (response.id === "plots") {
      const { showPlotManager } = await import("../plots-ui");
      await showPlotManager(player);
      continue;
    }
    if (response.id === "claims") {
      const { showClaimsAdminMenu } = await import("../claims-ui");
      await showClaimsAdminMenu(player);
      continue;
    }
    if (response.id === "rtp") {
      const { showRtpAdminMenu } = await import("../rtp-ui");
      await showRtpAdminMenu(player);
      continue;
    }
    if (response.id === "customAreas") {
      const { showCustomAreasAdminMenu } = await import("../custom-areas-ui");
      await showCustomAreasAdminMenu(player);
      continue;
    }
    if (response.id === "lootChests") {
      const { showLootChestsAdminMenu } = await import("../loot-chests-ui");
      await showLootChestsAdminMenu(player);
      continue;
    }
    if (response.id === "generators") {
      const { showGeneratorAdminMenu } = await import("../admin-ui");
      await showGeneratorAdminMenu(player);
      continue;
    }
    if (response.id === "crates") {
      const { showCrateAdminMenu } = await import("../admin-ui");
      await showCrateAdminMenu(player);
      continue;
    }
    if (response.id === "prune") {
      const { showPruneDataMenu } = await import("../admin-ui");
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

    if (TauUi.isCanceledOrBack(response)) return;

    if (response.id === "combat") {
      const { showCombatSettingsAdmin } = await import("../social-ui");
      await showCombatSettingsAdmin(player);
      continue;
    }
    if (response.id === "moderation") {
      const { showModerationMenu } = await import("../admin-ui");
      await showModerationMenu(player);
      continue;
    }
    if (response.id === "tauItems") {
      const { showTauItemsAdminMenu } = await import("../admin-ui");
      await showTauItemsAdminMenu(player);
      continue;
    }
  }
}
