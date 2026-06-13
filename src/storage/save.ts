import { system, world } from "@minecraft/server";
import { invalidateBannedItemCache } from "../moderation/banned-items";
import { STORAGE_KEYS } from "../types";
import {
  state,
  safeSetDynamicJson,
  markStatsPlayerDirty,
  markStatsPlayerIdsDirty,
  normalizePlotStore,
  writePlotsIncrementalToSplitKeys,
  PLOTS_MIGRATION_MARKER_KEY,
  writePlayerShopsIncrementalToSplitKeys,
  writeCustomAreasToSplitKeys,
  writeClaimsToSplitKeys,
  writeLootChestsToSplitKeys,
  writeSplitDynamicJson,
} from "./state";

const pendingDynamicSaves = new Map<string, () => void>();
let dynamicSaveFlushScheduled = false;
let dynamicSaveFlushJobId: number | undefined;

function* flushDynamicSavesJob(): Generator<void, void, void> {
  const saves = [...pendingDynamicSaves.values()];
  pendingDynamicSaves.clear();
  for (const save of saves) {
    save();
    yield;
  }
  dynamicSaveFlushJobId = undefined;
  if (pendingDynamicSaves.size > 0) scheduleDynamicSaveFlush();
}

function scheduleDynamicSaveFlush(): void {
  if (dynamicSaveFlushScheduled) return;
  dynamicSaveFlushScheduled = true;
  system.runTimeout(() => {
    dynamicSaveFlushScheduled = false;
    if (dynamicSaveFlushJobId !== undefined) return;
    dynamicSaveFlushJobId = system.runJob(flushDynamicSavesJob());
  }, 5);
}

function scheduleDynamicSave(key: string, flush: () => void): void {
  pendingDynamicSaves.set(key, flush);
  scheduleDynamicSaveFlush();
}

export function flushPendingDynamicSaves(): void {
  const saves = [...pendingDynamicSaves.values()];
  pendingDynamicSaves.clear();
  for (const save of saves) save();
}

export function clearPendingDynamicSaves(): void {
  pendingDynamicSaves.clear();
}

export function saveForms() {
  scheduleDynamicSave(STORAGE_KEYS.forms, () => safeSetDynamicJson(STORAGE_KEYS.forms, state.forms));
}

export function saveShops() {
  scheduleDynamicSave(STORAGE_KEYS.shops, () => safeSetDynamicJson(STORAGE_KEYS.shops, state.shops));
}

export function saveBinds() {
  safeSetDynamicJson(STORAGE_KEYS.binds, state.binds);
}

export function saveSidebars() {
  scheduleDynamicSave(STORAGE_KEYS.sidebars, () => safeSetDynamicJson(STORAGE_KEYS.sidebars, state.sidebars));
}

export function saveConfig() {
  safeSetDynamicJson(STORAGE_KEYS.config, state.config);
}

export function saveRanks() {
  scheduleDynamicSave(STORAGE_KEYS.ranks, () => safeSetDynamicJson(STORAGE_KEYS.ranks, state.ranks));
}

export function saveChat() {
  scheduleDynamicSave(STORAGE_KEYS.chat, () => safeSetDynamicJson(STORAGE_KEYS.chat, state.chat));
}

export function saveStats() {
  markStatsPlayerIdsDirty();
  for (const playerId of Object.keys(state.stats.players)) {
    markStatsPlayerDirty(playerId);
  }
}

export function saveProfiles() {
  scheduleDynamicSave("tau:profiles", () => safeSetDynamicJson("tau:profiles", state.profiles));
}

export function savePlots() {
  writePlotsIncrementalToSplitKeys(normalizePlotStore(state.plots));
  world.setDynamicProperty(STORAGE_KEYS.plots, undefined);
  world.setDynamicProperty(PLOTS_MIGRATION_MARKER_KEY, true);
}

export function saveTpa() {
  scheduleDynamicSave(STORAGE_KEYS.tpa, () => safeSetDynamicJson(STORAGE_KEYS.tpa, state.tpa));
}

export function saveHomes() {
  scheduleDynamicSave(STORAGE_KEYS.homes, () => safeSetDynamicJson(STORAGE_KEYS.homes, state.homes));
}

export function savePay() {
  scheduleDynamicSave(STORAGE_KEYS.pay, () => safeSetDynamicJson(STORAGE_KEYS.pay, state.pay));
}

export function savePlayerSettings() {
  scheduleDynamicSave(STORAGE_KEYS.playerSettings, () => safeSetDynamicJson(STORAGE_KEYS.playerSettings, state.playerSettings));
}

export function saveTeams() {
  scheduleDynamicSave(STORAGE_KEYS.teams, () => safeSetDynamicJson(STORAGE_KEYS.teams, state.teams));
}

export function saveTeamHomes() {
  scheduleDynamicSave(STORAGE_KEYS.teamHomes, () => safeSetDynamicJson(STORAGE_KEYS.teamHomes, state.teamHomes));
}

export function savePrune() {
  scheduleDynamicSave("tau:prune", () => safeSetDynamicJson("tau:prune", state.prune));
}

export function saveWarps() {
  scheduleDynamicSave(STORAGE_KEYS.warps, () => safeSetDynamicJson(STORAGE_KEYS.warps, state.warps));
}

export function saveRtp() {
  scheduleDynamicSave(STORAGE_KEYS.rtp, () => safeSetDynamicJson(STORAGE_KEYS.rtp, state.rtp));
}

export function saveGenerators() {
  scheduleDynamicSave(STORAGE_KEYS.generators, () => safeSetDynamicJson(STORAGE_KEYS.generators, state.generators));
}

export function saveModeration() {
  invalidateBannedItemCache();
  scheduleDynamicSave(STORAGE_KEYS.moderation, () => {
    if (writeSplitDynamicJson(STORAGE_KEYS.moderation, state.moderation)) {
      world.setDynamicProperty(STORAGE_KEYS.moderation, undefined);
    }
  });
}

export function saveCrates() {
  scheduleDynamicSave(STORAGE_KEYS.crates, () => safeSetDynamicJson(STORAGE_KEYS.crates, state.crates));
}

export function saveTauItems() {
  scheduleDynamicSave(STORAGE_KEYS.tauItems, () => safeSetDynamicJson(STORAGE_KEYS.tauItems, state.tauItems));
}

export function saveCombat() {
  scheduleDynamicSave(STORAGE_KEYS.combat, () => safeSetDynamicJson(STORAGE_KEYS.combat, state.combat));
}

export function saveCustomAreas(): boolean {
  const ok = writeCustomAreasToSplitKeys(state.customAreas);
  world.setDynamicProperty(STORAGE_KEYS.customAreas, undefined);
  return ok;
}

export function saveLootChests(): boolean {
  const ok = writeLootChestsToSplitKeys(state.lootChests);
  world.setDynamicProperty(STORAGE_KEYS.lootChests, undefined);
  return ok;
}

export function saveCommandBuilder() {
  scheduleDynamicSave(STORAGE_KEYS.commandBuilder, () => safeSetDynamicJson(STORAGE_KEYS.commandBuilder, state.commandBuilder));
}

export function saveCustomRewards() {
  scheduleDynamicSave(STORAGE_KEYS.customRewards, () => safeSetDynamicJson(STORAGE_KEYS.customRewards, state.customRewards));
}

export function saveReferrals() {
  scheduleDynamicSave(STORAGE_KEYS.referrals, () => safeSetDynamicJson(STORAGE_KEYS.referrals, state.referrals));
}

export function saveClaims(): boolean {
  const ok = writeClaimsToSplitKeys(state.claims);
  world.setDynamicProperty(STORAGE_KEYS.claims, undefined);
  return ok;
}

export function savePlayerShops() {
  writePlayerShopsIncrementalToSplitKeys(state.playerShops);
  world.setDynamicProperty(STORAGE_KEYS.playerShops, undefined);
}
