import { system, world } from "@minecraft/server";
import { invalidateBannedItemCache } from "../moderation/banned-items";
import {
  STORAGE_KEYS,
  type ClaimStore,
  type CustomAreaStore,
  type LootChestStore,
  type PlayerShopStore,
  type TpaRequest,
} from "../types";
import {
  state,
} from "./state";
import { writeDynamicJSON, writeSplitDynamicJson, PLOTS_MIGRATION_MARKER_KEY } from "./dynamic-json";
import { requestStatsFlush, markAllStatsPlayersDirty } from "./split-keys/stats";
import { normalizePlotStore, writePlotsIncrementalToSplitKeys, writePlotPlayerToSplitKeys, getPersistedPlotKeys } from "./split-keys/plots";
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
  PLOTS_SNAPSHOT_PREFIX,
  PLAYER_SHOPS_CONFIG_KEY,
  PLAYER_SHOPS_EARNINGS_PREFIX,
  PLAYER_SHOPS_LISTING_PREFIX,
  PLAYER_SHOPS_SHOP_PREFIX,
} from "./dynamic-json";

type DynamicSave = () => boolean;
const pendingDynamicSaves = new Map<string, DynamicSave>();
const failedDynamicSaveKeys = new Set<string>();
let dynamicSaveFlushTimeoutId: number | undefined;
let dynamicSaveFlushJobId: number | undefined;
const DYNAMIC_SAVES_PER_PASS = 8;

function tryFlushDynamicSave(key: string, save: DynamicSave): void {
  if (pendingDynamicSaves.get(key) !== save) return;
  try {
    if (!save()) throw new Error("write returned false");
    if (pendingDynamicSaves.get(key) === save) pendingDynamicSaves.delete(key);
    failedDynamicSaveKeys.delete(key);
  } catch {
    if (!failedDynamicSaveKeys.has(key)) {
      console.warn(`[TauUtils] Save for ${key} failed; keeping it queued for retry.`);
      failedDynamicSaveKeys.add(key);
    }
    // Move a failing entry to the back so other stores still make progress.
    if (pendingDynamicSaves.get(key) === save) {
      pendingDynamicSaves.delete(key);
      pendingDynamicSaves.set(key, save);
    }
  }
}

function* flushDynamicSavesJob(): Generator<void, void, void> {
  try {
    const saves: Array<[string, DynamicSave]> = [];
    for (const entry of pendingDynamicSaves) {
      saves.push(entry);
      if (saves.length >= DYNAMIC_SAVES_PER_PASS) break;
    }
    for (const [key, save] of saves) {
      tryFlushDynamicSave(key, save);
      yield;
    }
  } finally {
    dynamicSaveFlushJobId = undefined;
    if (pendingDynamicSaves.size > 0) scheduleDynamicSaveFlush(failedDynamicSaveKeys.size > 0 ? 100 : 5);
  }
}

function scheduleDynamicSaveFlush(delayTicks = 5): void {
  if (dynamicSaveFlushTimeoutId !== undefined || dynamicSaveFlushJobId !== undefined) return;
  dynamicSaveFlushTimeoutId = system.runTimeout(() => {
    dynamicSaveFlushTimeoutId = undefined;
    if (pendingDynamicSaves.size === 0 || dynamicSaveFlushJobId !== undefined) return;
    dynamicSaveFlushJobId = system.runJob(flushDynamicSavesJob());
  }, delayTicks);
}

function scheduleDynamicSave(key: string, flush: DynamicSave): void {
  pendingDynamicSaves.set(key, flush);
  scheduleDynamicSaveFlush();
}

export function flushPendingDynamicSaves(): void {
  // Dirty entries remain visible here even while the yielding worker is active.
  for (const [key, save] of [...pendingDynamicSaves]) tryFlushDynamicSave(key, save);
  if (pendingDynamicSaves.size > 0) scheduleDynamicSaveFlush(100);
}

export function clearPendingDynamicSaves(): void {
  if (dynamicSaveFlushJobId !== undefined) system.clearJob(dynamicSaveFlushJobId);
  if (dynamicSaveFlushTimeoutId !== undefined) system.clearRun(dynamicSaveFlushTimeoutId);
  dynamicSaveFlushJobId = undefined;
  dynamicSaveFlushTimeoutId = undefined;
  pendingDynamicSaves.clear();
  failedDynamicSaveKeys.clear();
  plotManifestDirty = false;
}

export function saveForms() {
  scheduleDynamicSave(STORAGE_KEYS.forms, () => writeDynamicJSON(STORAGE_KEYS.forms, state.forms));
}

export function saveShops() {
  scheduleDynamicSave(STORAGE_KEYS.shops, () => writeDynamicJSON(STORAGE_KEYS.shops, state.shops));
}

export function saveBinds() {
  scheduleDynamicSave(STORAGE_KEYS.binds, () => writeDynamicJSON(STORAGE_KEYS.binds, state.binds));
}

export function saveSidebars() {
  scheduleDynamicSave(STORAGE_KEYS.sidebars, () => writeDynamicJSON(STORAGE_KEYS.sidebars, state.sidebars));
}

export function saveConfig() {
  scheduleDynamicSave(STORAGE_KEYS.config, () => writeDynamicJSON(STORAGE_KEYS.config, state.config));
}

export function saveRanks() {
  scheduleDynamicSave(STORAGE_KEYS.ranks, () => writeDynamicJSON(STORAGE_KEYS.ranks, state.ranks));
}

export function saveChat() {
  scheduleDynamicSave(STORAGE_KEYS.chat, () => writeDynamicJSON(STORAGE_KEYS.chat, state.chat));
}

export function saveStats(fullResync = false): void {
  // Hot path: per-mutation sites already mark individual players dirty, so by
  // default only flush what changed. Pass fullResync=true for admin flows
  // (e.g. after bulk prune) that need every in-memory player rewritten.
  if (fullResync) markAllStatsPlayersDirty();
  else requestStatsFlush();
}

export function saveProfiles() {
  scheduleDynamicSave("tau:profiles", () => writeDynamicJSON("tau:profiles", state.profiles));
}

let plotManifestDirty = false;

export function savePlots(playerId?: string): void {
  const key = playerId === undefined ? STORAGE_KEYS.plots : `${PLOTS_SNAPSHOT_PREFIX}${playerId}`;
  scheduleDynamicSave(key, () => {
    if (playerId === undefined) {
      plotManifestDirty = true;
      if (!writePlotsIncrementalToSplitKeys(normalizePlotStore(state.plots))) return false;
      world.setDynamicProperty(STORAGE_KEYS.plots, undefined);
      world.setDynamicProperty(PLOTS_MIGRATION_MARKER_KEY, true);
    } else {
      const result = writePlotPlayerToSplitKeys(state.plots, playerId);
      plotManifestDirty ||= result.keysChanged;
      if (!result.ok) return false;
    }
    // Existing snapshot updates do not change manifest membership.
    if (plotManifestDirty) {
      if (!updateManifestAfterSplitWrite("plots", getPersistedPlotKeys())) return false;
      plotManifestDirty = false;
    }
    return true;
  });
}

export function saveTpa() {
  scheduleDynamicSave(STORAGE_KEYS.tpa, () => writeDynamicJSON(STORAGE_KEYS.tpa, state.tpa));
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
  scheduleDynamicSave(STORAGE_KEYS.homes, () => writeDynamicJSON(STORAGE_KEYS.homes, state.homes));
}

export function savePay() {
  scheduleDynamicSave(STORAGE_KEYS.pay, () => writeDynamicJSON(STORAGE_KEYS.pay, state.pay));
}

export function savePlayerSettings() {
  scheduleDynamicSave(STORAGE_KEYS.playerSettings, () => writeDynamicJSON(STORAGE_KEYS.playerSettings, state.playerSettings));
}

export function saveTeams() {
  scheduleDynamicSave(STORAGE_KEYS.teams, () => writeDynamicJSON(STORAGE_KEYS.teams, state.teams));
}

export function saveTeamHomes() {
  scheduleDynamicSave(STORAGE_KEYS.teamHomes, () => writeDynamicJSON(STORAGE_KEYS.teamHomes, state.teamHomes));
}

export function savePrune() {
  scheduleDynamicSave("tau:prune", () => writeDynamicJSON("tau:prune", state.prune));
}

export function saveWarps() {
  scheduleDynamicSave(STORAGE_KEYS.warps, () => writeDynamicJSON(STORAGE_KEYS.warps, state.warps));
}

export function saveRtp() {
  scheduleDynamicSave(STORAGE_KEYS.rtp, () => writeDynamicJSON(STORAGE_KEYS.rtp, state.rtp));
}

export function saveGenerators() {
  scheduleDynamicSave(STORAGE_KEYS.generators, () => writeDynamicJSON(STORAGE_KEYS.generators, state.generators));
}

export function saveModeration() {
  invalidateBannedItemCache();
  scheduleDynamicSave(STORAGE_KEYS.moderation, () => {
    if (!writeSplitDynamicJson(STORAGE_KEYS.moderation, state.moderation)) return false;
    world.setDynamicProperty(STORAGE_KEYS.moderation, undefined);
    return true;
  });
}

export function saveCrates() {
  scheduleDynamicSave(STORAGE_KEYS.crates, () => writeDynamicJSON(STORAGE_KEYS.crates, state.crates));
}

export function saveTauItems() {
  scheduleDynamicSave(STORAGE_KEYS.tauItems, () => writeDynamicJSON(STORAGE_KEYS.tauItems, state.tauItems));
}

export function saveCombat() {
  scheduleDynamicSave(STORAGE_KEYS.combat, () => writeDynamicJSON(STORAGE_KEYS.combat, state.combat));
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
  scheduleDynamicSave(STORAGE_KEYS.commandBuilder, () => writeDynamicJSON(STORAGE_KEYS.commandBuilder, state.commandBuilder));
}

export function saveCustomRewards() {
  scheduleDynamicSave(STORAGE_KEYS.customRewards, () => writeDynamicJSON(STORAGE_KEYS.customRewards, state.customRewards));
}

export function saveReferrals() {
  scheduleDynamicSave(STORAGE_KEYS.referrals, () => {
    state.referrals.redemptions = state.referrals.redemptions.slice(0, Math.max(1, state.referrals.config.maxRedemptionHistory));
    if (!writeSplitDynamicJson(STORAGE_KEYS.referrals, state.referrals)) return false;
    world.setDynamicProperty(STORAGE_KEYS.referrals, undefined);
    return true;
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
// saves (including dirty plot entries) and the stats dirty sets. Calls only
// existing flush fns; performs no player or world-property id scans. Intended for
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
    // Failed stats entries remain dirty for the next scheduled attempt.
  }
}
