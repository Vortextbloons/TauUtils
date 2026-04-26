import { world } from "@minecraft/server";
import { STORAGE_KEYS } from "../types";
import {
  state,
  safeSetDynamicJson,
  markStatsPlayerDirty,
  markStatsPlayerIdsDirty,
  normalizePlotStore,
  writePlotsToSplitKeys,
  PLOTS_MIGRATION_MARKER_KEY,
  PLAYER_SHOPS_CONFIG_KEY,
  PLAYER_SHOPS_SHOP_PREFIX,
  PLAYER_SHOPS_LISTING_PREFIX,
  PLAYER_SHOPS_EARNINGS_PREFIX,
} from "./state";

export function saveForms() {
  safeSetDynamicJson(STORAGE_KEYS.forms, state.forms);
}

export function saveShops() {
  safeSetDynamicJson(STORAGE_KEYS.shops, state.shops);
}

export function saveBinds() {
  safeSetDynamicJson(STORAGE_KEYS.binds, state.binds);
}

export function saveSidebars() {
  safeSetDynamicJson(STORAGE_KEYS.sidebars, state.sidebars);
}

export function saveConfig() {
  safeSetDynamicJson(STORAGE_KEYS.config, state.config);
}

export function saveRanks() {
  safeSetDynamicJson(STORAGE_KEYS.ranks, state.ranks);
}

export function saveChat() {
  safeSetDynamicJson(STORAGE_KEYS.chat, state.chat);
}

export function saveStats() {
  markStatsPlayerIdsDirty();
  for (const playerId of Object.keys(state.stats.players)) {
    markStatsPlayerDirty(playerId);
  }
}

export function saveProfiles() {
  safeSetDynamicJson("tau:profiles", state.profiles);
}

export function savePlots() {
  writePlotsToSplitKeys(normalizePlotStore(state.plots));
  world.setDynamicProperty(STORAGE_KEYS.plots, undefined);
  world.setDynamicProperty(PLOTS_MIGRATION_MARKER_KEY, true);
}

export function saveTpa() {
  safeSetDynamicJson(STORAGE_KEYS.tpa, state.tpa);
}

export function saveHomes() {
  safeSetDynamicJson(STORAGE_KEYS.homes, state.homes);
}

export function savePay() {
  safeSetDynamicJson(STORAGE_KEYS.pay, state.pay);
}

export function savePlayerSettings() {
  safeSetDynamicJson(STORAGE_KEYS.playerSettings, state.playerSettings);
}

export function saveTeams() {
  safeSetDynamicJson(STORAGE_KEYS.teams, state.teams);
}

export function savePrune() {
  safeSetDynamicJson("tau:prune", state.prune);
}

export function saveWarps() {
  safeSetDynamicJson(STORAGE_KEYS.warps, state.warps);
}

export function saveGenerators() {
  safeSetDynamicJson(STORAGE_KEYS.generators, state.generators);
}

export function saveModeration() {
  safeSetDynamicJson(STORAGE_KEYS.moderation, state.moderation);
}

export function saveCrates() {
  safeSetDynamicJson(STORAGE_KEYS.crates, state.crates);
}

export function saveTauItems() {
  safeSetDynamicJson(STORAGE_KEYS.tauItems, state.tauItems);
}

export function saveCombat() {
  safeSetDynamicJson(STORAGE_KEYS.combat, state.combat);
}

export function savePlayerShops() {
  const keys = world.getDynamicPropertyIds();
  for (const key of keys) {
    if (key.startsWith(PLAYER_SHOPS_SHOP_PREFIX) || key.startsWith(PLAYER_SHOPS_LISTING_PREFIX) || key.startsWith(PLAYER_SHOPS_EARNINGS_PREFIX)) {
      world.setDynamicProperty(key, undefined);
    }
  }

  safeSetDynamicJson(PLAYER_SHOPS_CONFIG_KEY, state.playerShops.config);
  for (const [shopId, shop] of Object.entries(state.playerShops.shops)) {
    safeSetDynamicJson(`${PLAYER_SHOPS_SHOP_PREFIX}${shopId}`, shop);
  }
  for (const [listingId, listing] of Object.entries(state.playerShops.listings)) {
    safeSetDynamicJson(`${PLAYER_SHOPS_LISTING_PREFIX}${listingId}`, listing);
  }
  for (const [playerId, earnings] of Object.entries(state.playerShops.earningsByPlayerId)) {
    safeSetDynamicJson(`${PLAYER_SHOPS_EARNINGS_PREFIX}${playerId}`, earnings);
  }

  world.setDynamicProperty(STORAGE_KEYS.playerShops, undefined);
}