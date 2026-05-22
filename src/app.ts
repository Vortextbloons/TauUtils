import { system, world } from "@minecraft/server";
import { isFeatureEnabled, loadState, saveShops, state } from "./storage";
import { initializeOnlinePlayersAfterReload, registerEventInterceptors } from "./events";
import { registerCustomCommands } from "./commands";
import { registerSidebarSystem } from "./sidebar";
import { registerLootChestSystem } from "./loot-chests";
import { reconcileAllPlotState } from "./plots";
import { reconcileTeamAssignments } from "./teams";
import { formatTauUtilsLoadedMessage } from "./shared/version";

export { state } from "./storage";
export {
  tell,
  findForm,
  findShopProfile,
  canonicalShopId,
  saveForms,
  saveShops,
  saveBinds,
  saveSidebars,
  saveRanks,
  saveChat,
  getRankById,
  getPlayerRank,
  assignRank,
  removeRank,
  hasPermission,
  formatChatMessage,
} from "./storage";

export { openFormById, showCreatorMenu, showBindingsEditor, showRankManager, showRankEditor, showPlayerRankAssign, showRankMenu, showProfileBrowser, showPlayerProfileViewer, showPlayerProfileEditor, showPlotManager, showTpaMenu, showHomesMenu, showPayMenu, showPlayerSettingsMenu, showTeamMenu } from "./ui";
export { openShopTransaction, showShopProfilesEditor, sellAllSellableItems } from "./shop";
export { openMyPlayerShop, openPlayerMarketplace, openPlayerShopAdmin, claimPlayerShopEarnings } from "./player-shops";
export { showSidebarEditor } from "./sidebar";

function ensureDefaults() {
  if (!state.shops.default) {
    state.shops.default = {
      id: "default",
      currencyObjective: "money",
      items: [],
    };
    saveShops();
  }
}

let initialized = false;
let startupScheduled = false;
let startupPhase = 0;

function bootstrap() {
  if (initialized || startupScheduled) return;
  startupScheduled = true;

  system.runTimeout(() => {
    if (initialized || startupPhase !== 0) return;
    startupPhase = 1;
    loadState();
    ensureDefaults();
  }, 1);

  system.runTimeout(() => {
    if (initialized || startupPhase !== 1) return;
    startupPhase = 2;
    reconcileTeamAssignments();
    if (isFeatureEnabled("plots")) reconcileAllPlotState("startup_phase_2");
    registerEventInterceptors();
    registerSidebarSystem();
    registerLootChestSystem();
    initializeOnlinePlayersAfterReload();
  }, 2);

  system.runTimeout(() => {
    if (initialized || startupPhase !== 2) return;
    startupPhase = 3;
    if (isFeatureEnabled("plots")) reconcileAllPlotState("startup_phase_3");
    if (isFeatureEnabled("plots")) reconcileAllPlotState("startup_finalize");
    world.sendMessage(formatTauUtilsLoadedMessage());
    initialized = true;
  }, 20);
}

world.afterEvents.worldLoad.subscribe(() => {
  bootstrap();
});

system.beforeEvents.startup.subscribe((event) => {
  registerCustomCommands(event);
});
