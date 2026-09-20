import { system, world } from "@minecraft/server";
import { invalidateBannedItemCache } from "../moderation/banned-items";
import {
  STORAGE_KEYS,
  type ClaimStore,
  type CustomAreaStore,
  type LootChestStore,
  type PlayerShopStore,
  type PlotStore,
  type TpaRequest,
} from "../types";
import {
  state,
} from "./state";
import { safeSetDynamicJson, writeSplitDynamicJson, PLOTS_MIGRATION_MARKER_KEY } from "./dynamic-json";
import { requestStatsFlush, markAllStatsPlayersDirty } from "./split-keys/stats";
import { normalizePlotStore, writePlotsIncrementalToSplitKeys } from "./split-keys/plots";
import { writePlayerShopsIncrementalToSplitKeys } from "./split-keys/player-shops";
import { writeCustomAreasToSplitKeys } from "./split-keys/custom-areas";
import { writeClaimsToSplitKeys } from "./split-keys/claims";
import { writeLootChestsToSplitKeys } from "./split-keys/loot-chests";
import {
  directSaveTpaCooldown,
  directSaveTpaInbox,
  directSaveTpaOutbox,
} from "./split-keys/tpa";
import { flushStatsDirtySync } from "./split-keys/stats";
import { updateManifestAfterSplitWrite } from "./manifests";
import {
  CLAIMS_CLAIM_PREFIX,
  CLAIMS_CONFIG_KEY,
  CUSTOM_AREAS_AREA_PREFIX,
  CUSTOM_AREAS_CONFIG_KEY,
  LOOT_CHESTS_CHEST_PREFIX,
  LOOT_CHESTS_CONFIG_KEY,
  LOOT_CHESTS_POOL_PREFIX,
  LOOT_CHESTS_SNAPSHOT_PREFIX,
  PLOTS_CONFIG_KEY,
  PLOTS_PLAYER_SLOT_PREFIX,
  PLOTS_SLOT_PREFIX,
  PLOTS_SNAPSHOT_PREFIX,
  PLAYER_SHOPS_CONFIG_KEY,
  PLAYER_SHOPS_EARNINGS_PREFIX,
  PLAYER_SHOPS_LISTING_PREFIX,
  PLAYER_SHOPS_SHOP_PREFIX,
} from "./dynamic-json";

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

export function saveStats(fullResync = false): void {
  // Hot path: per-mutation sites already mark individual players dirty, so by
  // default only flush what changed. Pass fullResync=true for admin flows
  // (e.g. after bulk prune) that need every in-memory player rewritten.
  if (fullResync) markAllStatsPlayersDirty();
  else requestStatsFlush();
}

export function saveProfiles() {
  scheduleDynamicSave("tau:profiles", () => safeSetDynamicJson("tau:profiles", state.profiles));
}

export function savePlots(): void {
  const normalized = normalizePlotStore(state.plots);
  const ok = writePlotsIncrementalToSplitKeys(normalized);
  if (ok) {
    world.setDynamicProperty(STORAGE_KEYS.plots, undefined);
    world.setDynamicProperty(PLOTS_MIGRATION_MARKER_KEY, true);
    updateManifestAfterSplitWrite("plots", plotManifestKeys(normalized));
  }
}

export function saveTpa() {
  scheduleDynamicSave(STORAGE_KEYS.tpa, () => safeSetDynamicJson(STORAGE_KEYS.tpa, state.tpa));
}

export function saveTpaInboxFor(playerId: string, requests: TpaRequest[]): boolean {
  return directSaveTpaInbox(playerId, requests);
}

export function saveTpaOutboxFor(playerId: string, requests: TpaRequest[]): boolean {
  return directSaveTpaOutbox(playerId, requests);
}

export function saveTpaCooldownFor(playerId: string, untilMs: number): boolean {
  return directSaveTpaCooldown(playerId, untilMs);
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
  if (ok) {
    world.setDynamicProperty(STORAGE_KEYS.customAreas, undefined);
    updateManifestAfterSplitWrite("custom-areas", customAreaManifestKeys(state.customAreas));
  }
  return ok;
}

export function saveLootChests(): boolean {
  const ok = writeLootChestsToSplitKeys(state.lootChests);
  if (ok) {
    world.setDynamicProperty(STORAGE_KEYS.lootChests, undefined);
    updateManifestAfterSplitWrite("loot-chests", lootChestManifestKeys(state.lootChests));
  }
  return ok;
}

export function saveCommandBuilder() {
  scheduleDynamicSave(STORAGE_KEYS.commandBuilder, () => safeSetDynamicJson(STORAGE_KEYS.commandBuilder, state.commandBuilder));
}

export function saveCustomRewards() {
  scheduleDynamicSave(STORAGE_KEYS.customRewards, () => safeSetDynamicJson(STORAGE_KEYS.customRewards, state.customRewards));
}

export function saveReferrals() {
  scheduleDynamicSave(STORAGE_KEYS.referrals, () => {
    state.referrals.redemptions = state.referrals.redemptions.slice(0, Math.max(1, state.referrals.config.maxRedemptionHistory));
    if (writeSplitDynamicJson(STORAGE_KEYS.referrals, state.referrals)) {
      world.setDynamicProperty(STORAGE_KEYS.referrals, undefined);
    }
  });
}

export function saveClaims(): boolean {
  const ok = writeClaimsToSplitKeys(state.claims);
  if (ok) {
    world.setDynamicProperty(STORAGE_KEYS.claims, undefined);
    updateManifestAfterSplitWrite("claims", claimManifestKeys(state.claims));
  }
  return ok;
}

export function savePlayerShops(): void {
  const ok = writePlayerShopsIncrementalToSplitKeys(state.playerShops);
  if (ok) {
    world.setDynamicProperty(STORAGE_KEYS.playerShops, undefined);
    updateManifestAfterSplitWrite("player-shops", playerShopManifestKeys(state.playerShops));
  }
}

// ---------------------------------------------------------------------------
// Manifest key builders (in-memory key names; no world scans)
// ---------------------------------------------------------------------------

function plotManifestKeys(store: PlotStore): string[] {
  const keys: string[] = [PLOTS_CONFIG_KEY];
  for (const slotId of Object.keys(store.slots)) keys.push(`${PLOTS_SLOT_PREFIX}${slotId}`);
  for (const playerId of Object.keys(store.playerToSlot)) keys.push(`${PLOTS_PLAYER_SLOT_PREFIX}${playerId}`);
  for (const playerId of Object.keys(store.snapshots)) keys.push(`${PLOTS_SNAPSHOT_PREFIX}${playerId}`);
  return keys;
}

function playerShopManifestKeys(store: PlayerShopStore): string[] {
  const keys: string[] = [PLAYER_SHOPS_CONFIG_KEY];
  for (const shopId of Object.keys(store.shops)) keys.push(`${PLAYER_SHOPS_SHOP_PREFIX}${shopId}`);
  for (const listingId of Object.keys(store.listings)) keys.push(`${PLAYER_SHOPS_LISTING_PREFIX}${listingId}`);
  for (const playerId of Object.keys(store.earningsByPlayerId)) keys.push(`${PLAYER_SHOPS_EARNINGS_PREFIX}${playerId}`);
  return keys;
}

function customAreaManifestKeys(store: CustomAreaStore): string[] {
  const keys: string[] = [CUSTOM_AREAS_CONFIG_KEY];
  for (const areaId of Object.keys(store.areas)) keys.push(`${CUSTOM_AREAS_AREA_PREFIX}${areaId}`);
  return keys;
}

function lootChestManifestKeys(store: LootChestStore): string[] {
  const keys: string[] = [LOOT_CHESTS_CONFIG_KEY];
  for (const poolId of Object.keys(store.pools)) keys.push(`${LOOT_CHESTS_POOL_PREFIX}${poolId}`);
  for (const snapshot of Object.values(store.snapshots)) {
    keys.push(`${LOOT_CHESTS_SNAPSHOT_PREFIX}${snapshot.poolId}:${snapshot.id}`);
  }
  for (const chestId of Object.keys(store.chests)) keys.push(`${LOOT_CHESTS_CHEST_PREFIX}${chestId}`);
  return keys;
}

function claimManifestKeys(store: ClaimStore): string[] {
  const keys: string[] = [CLAIMS_CONFIG_KEY];
  for (const claimId of Object.keys(store.claims)) keys.push(`${CLAIMS_CLAIM_PREFIX}${claimId}`);
  return keys;
}

// Synchronously drain every dirty persistence queue: debounced single-blob
// saves, the stats dirty sets, and the incremental plot writer. Calls only
// existing flush fns; performs no player or id scans. Intended for
// shutdown/prune paths that must not lose acknowledged mutations.
export function flushAllDirtyQueues(): void {
  try {
    flushPendingDynamicSaves();
  } catch {
    // ignore; remaining queues still flush below
  }
  try {
    flushStatsDirtySync();
  } catch {
    // ignore; plot queue still flushes below
  }
  try {
    const normalized = normalizePlotStore(state.plots);
    if (writePlotsIncrementalToSplitKeys(normalized)) {
      updateManifestAfterSplitWrite("plots", plotManifestKeys(normalized));
    }
  } catch {
    // ignore sync-flush failures; scheduled jobs retry on next mutation
  }
}
