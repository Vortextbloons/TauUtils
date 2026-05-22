import { system, world } from "@minecraft/server";
import {
  STORAGE_KEYS,
  type BindingStore,
  type ChatConfig,
  type CombatStore,
  type CommandBuilderStore,
  type ConfigStore,
  type CrateStore,
  type CustomAreaStore,
  type FormDefinition,
  type GeneratorStore,
  type HomeStore,
  type LootChestStore,
  type ModerationStore,
  type PayStore,
  type PlayerProfilesStore,
  type PlayerSettingsStore,
  type PlayerShopStore,
  type PlotStore,
  type PruneStore,
  type RankStore,
  type ShopProfile,
  type SidebarStore,
  type StatsStore,
  type TauItemsStore,
  type TeamStore,
  type TpaStore,
  type WarpStore,
} from "../types";
import { invalidateBannedItemCache } from "../moderation/banned-items";
import { normalizeBlockId } from "../shared/item-id";
import {
  readDynamicJSON,
  readSplitDynamicJson,
  safeSetDynamicJson,
} from "./dynamic-json";
import {
  defaultChatConfig,
  defaultCombatStore,
  defaultCommandBuilderStore,
  defaultConfig,
  defaultCrateStore,
  defaultCustomAreaStore,
  defaultGeneratorStore,
  defaultHomeStore,
  defaultLootChestStore,
  defaultModerationStore,
  defaultPayStore,
  defaultPlayerSettingsStore,
  defaultPlayerShopStore,
  defaultPlayerStats,
  defaultPlotStore,
  defaultPruneStore,
  defaultRankStore,
  defaultTauItemsStore,
  defaultTeamStore,
  defaultTpaStore,
  defaultWarpStore,
} from "./defaults";
import { loadStatsFromSplitKeys } from "./split-keys/stats";
import { loadPlayerShopsFromSplitKeys, rememberPlayerShopSplitKeys } from "./split-keys/player-shops";
import { loadCustomAreasFromSplitKeys } from "./split-keys/custom-areas";
import { loadLootChestsFromSplitKeys } from "./split-keys/loot-chests";
import { loadPlotsFromSplitKeys, normalizePlotStore, rememberPlotSplitKeys, migrateLegacyPlotsToSplitOneShot } from "./split-keys/plots";

// ---------------------------------------------------------------------------
// State object
// ---------------------------------------------------------------------------

export const state: {
  forms: Record<string, FormDefinition>;
  shops: Record<string, ShopProfile>;
  binds: BindingStore;
  sidebars: SidebarStore;
  config: ConfigStore;
  ranks: RankStore;
  chat: ChatConfig;
  stats: StatsStore;
  profiles: PlayerProfilesStore;
  plots: PlotStore;
  tpa: TpaStore;
  homes: HomeStore;
  pay: PayStore;
  playerSettings: PlayerSettingsStore;
  teams: TeamStore;
  prune: PruneStore;
  warps: WarpStore;
  generators: GeneratorStore;
  moderation: ModerationStore;
  crates: CrateStore;
  tauItems: TauItemsStore;
  combat: CombatStore;
  playerShops: PlayerShopStore;
  customAreas: CustomAreaStore;
  lootChests: LootChestStore;
  commandBuilder: CommandBuilderStore;
} = {
  forms: {},
  shops: {},
  binds: { itemBinds: {}, entityTagBinds: {} },
  sidebars: { enabled: true, sidebars: {} },
  config: defaultConfig(),
  ranks: defaultRankStore(),
  chat: defaultChatConfig(),
  stats: { playerIds: {}, players: {} },
  profiles: { configs: {} },
  plots: defaultPlotStore(),
  tpa: defaultTpaStore(),
  homes: defaultHomeStore(),
  pay: defaultPayStore(),
  playerSettings: defaultPlayerSettingsStore(),
  teams: defaultTeamStore(),
  prune: defaultPruneStore(),
  warps: defaultWarpStore(),
  generators: defaultGeneratorStore(),
  moderation: defaultModerationStore(),
  crates: defaultCrateStore(),
  tauItems: defaultTauItemsStore(),
  combat: defaultCombatStore(),
  playerShops: defaultPlayerShopStore(),
  customAreas: defaultCustomAreaStore(),
  lootChests: defaultLootChestStore(),
  commandBuilder: defaultCommandBuilderStore(),
};

// ---------------------------------------------------------------------------
// loadState — read everything from dynamic properties
// ---------------------------------------------------------------------------

export function loadState() {
  migrateLegacyPlotsToSplitOneShot();
  const dynamicPropertyIds = world.getDynamicPropertyIds();

  state.forms = readDynamicJSON<Record<string, FormDefinition>>(STORAGE_KEYS.forms, {});
  state.shops = readDynamicJSON<Record<string, ShopProfile>>(STORAGE_KEYS.shops, {});
  state.binds = readDynamicJSON<BindingStore>(STORAGE_KEYS.binds, { itemBinds: {}, entityTagBinds: {} });
  state.sidebars = readDynamicJSON<SidebarStore>(STORAGE_KEYS.sidebars, { enabled: true, sidebars: {} });
  state.config = readDynamicJSON<ConfigStore>(STORAGE_KEYS.config, defaultConfig());
  state.config.features.combat ??= defaultConfig().features.combat;
  state.config.features.moderation ??= defaultConfig().features.moderation;
  state.config.features.customAreas ??= defaultConfig().features.customAreas;
  state.config.features.lootChests ??= defaultConfig().features.lootChests;
  state.config.features.commandBuilder ??= defaultConfig().features.commandBuilder;
  state.ranks = readDynamicJSON<RankStore>(STORAGE_KEYS.ranks, defaultRankStore());
  state.chat = readDynamicJSON<ChatConfig>(STORAGE_KEYS.chat, defaultChatConfig());
  const splitStats = loadStatsFromSplitKeys(dynamicPropertyIds);
  state.stats = splitStats.hasSplitData ? splitStats.store : readDynamicJSON<StatsStore>("tau:stats", { playerIds: {}, players: {} });
  state.profiles = readDynamicJSON<PlayerProfilesStore>("tau:profiles", { configs: {} });
  const splitPlots = loadPlotsFromSplitKeys(dynamicPropertyIds);
  state.plots = splitPlots.hasSplitData ? normalizePlotStore(splitPlots.store) : defaultPlotStore();
  rememberPlotSplitKeys(state.plots);
  state.tpa = readDynamicJSON<TpaStore>(STORAGE_KEYS.tpa, defaultTpaStore());
  state.homes = readDynamicJSON<HomeStore>(STORAGE_KEYS.homes, defaultHomeStore());
  state.pay = readDynamicJSON<PayStore>(STORAGE_KEYS.pay, defaultPayStore());
  state.playerSettings = readDynamicJSON<PlayerSettingsStore>(STORAGE_KEYS.playerSettings, defaultPlayerSettingsStore());
  state.teams = readDynamicJSON<TeamStore>(STORAGE_KEYS.teams, defaultTeamStore());
  state.prune = readDynamicJSON<PruneStore>("tau:prune", defaultPruneStore());
  state.warps = readDynamicJSON<WarpStore>(STORAGE_KEYS.warps, defaultWarpStore());
  state.generators = readDynamicJSON<GeneratorStore>(STORAGE_KEYS.generators, defaultGeneratorStore());
  let generatorsChanged = false;
  const placementsByDefinitionId = new Map<string, typeof state.generators.placed[string][]>();
  for (const placed of Object.values(state.generators.placed)) {
    const placements = placementsByDefinitionId.get(placed.definitionId) ?? [];
    placements.push(placed);
    placementsByDefinitionId.set(placed.definitionId, placements);
  }
  for (const def of Object.values(state.generators.definitions)) {
    const legacyDef = def as typeof def & { autoBreakerPurchased?: boolean; autoBreakerEnabled?: boolean };
    const legacyPurchased = Boolean(legacyDef.autoBreakerPurchased);
    const legacyEnabled = Boolean(legacyDef.autoBreakerEnabled);
    if (!legacyPurchased && !legacyEnabled) continue;

    const placements = placementsByDefinitionId.get(def.id) ?? [];
    if (placements.length > 0) {
      const target = placements.reduce(
        (best, placed) => (placed.tier > best.tier ? placed : best),
        placements[0]
      );
      target.autoBreakerPurchased = legacyPurchased;
      target.autoBreakerEnabled = legacyPurchased && legacyEnabled;
      generatorsChanged = true;
    }

    delete legacyDef.autoBreakerPurchased;
    delete legacyDef.autoBreakerEnabled;
    generatorsChanged = true;
  }
  if (generatorsChanged) {
    safeSetDynamicJson(STORAGE_KEYS.generators, state.generators);
  }
  const splitModeration = readSplitDynamicJson<ModerationStore>(STORAGE_KEYS.moderation, defaultModerationStore());
  state.moderation = splitModeration.hasSplitData ? splitModeration.value : readDynamicJSON<ModerationStore>(STORAGE_KEYS.moderation, defaultModerationStore());
  state.moderation.inspectionSnapshots ??= {};
  for (const snapshot of Object.values(state.moderation.inspectionSnapshots)) {
    snapshot.inventory ??= [];
    snapshot.enderChest ??= [];
  }
  invalidateBannedItemCache();
  state.crates = readDynamicJSON<CrateStore>(STORAGE_KEYS.crates, defaultCrateStore());
  state.tauItems = readDynamicJSON<TauItemsStore>(STORAGE_KEYS.tauItems, defaultTauItemsStore());
  state.combat = readDynamicJSON<CombatStore>(STORAGE_KEYS.combat, defaultCombatStore());
  state.combat.config.enabled ??= defaultCombatStore().config.enabled;
  state.combat.config.combatTimeSeconds ??= defaultCombatStore().config.combatTimeSeconds;
  state.combat.config.announceLogouts ??= defaultCombatStore().config.announceLogouts;
  state.combat.config.blockCommands ??= defaultCombatStore().config.blockCommands;
  state.combat.config.enterMessage ??= defaultCombatStore().config.enterMessage;
  state.combat.config.exitMessage ??= defaultCombatStore().config.exitMessage;
  state.combat.config.logoutBroadcastMessage ??= defaultCombatStore().config.logoutBroadcastMessage;
  state.combat.config.rejoinPenaltyMessage ??= defaultCombatStore().config.rejoinPenaltyMessage;
  state.combat.config.blockedCommandMessage ??= defaultCombatStore().config.blockedCommandMessage;
  state.combat.config.killConditions ??= defaultCombatStore().config.killConditions;
  state.combat.config.killConditions.enabled ??= true;
  state.combat.config.killConditions.rules ??= [];
  const splitShops = loadPlayerShopsFromSplitKeys(dynamicPropertyIds);
  state.playerShops = splitShops.hasSplitData ? splitShops.store : readDynamicJSON<PlayerShopStore>(STORAGE_KEYS.playerShops, defaultPlayerShopStore());
  state.playerShops.config.enabled ??= defaultPlayerShopStore().config.enabled;
  state.playerShops.config.defaultCurrencyObjective ??= defaultPlayerShopStore().config.defaultCurrencyObjective;
  state.playerShops.config.allowCustomItems ??= defaultPlayerShopStore().config.allowCustomItems;
  state.playerShops.config.minPricePerUnit ??= defaultPlayerShopStore().config.minPricePerUnit;
  state.playerShops.config.maxPricePerUnit ??= defaultPlayerShopStore().config.maxPricePerUnit;
  state.playerShops.config.taxPercent ??= defaultPlayerShopStore().config.taxPercent;
  state.playerShops.config.maxListingsPerShop ??= defaultPlayerShopStore().config.maxListingsPerShop;
  state.playerShops.config.defaultVisibility ??= defaultPlayerShopStore().config.defaultVisibility;
  state.playerShops.config.announceSales ??= defaultPlayerShopStore().config.announceSales;
  state.playerShops.shops ??= {};
  state.playerShops.listings ??= {};
  state.playerShops.earningsByPlayerId ??= {};
  rememberPlayerShopSplitKeys(state.playerShops);
  const splitCustomAreas = loadCustomAreasFromSplitKeys(dynamicPropertyIds);
  state.customAreas = splitCustomAreas.hasSplitData ? splitCustomAreas.store : readDynamicJSON<CustomAreaStore>(STORAGE_KEYS.customAreas, defaultCustomAreaStore());
  state.customAreas.config = { ...defaultCustomAreaStore().config, ...(state.customAreas.config ?? {}) };
  state.customAreas.areas ??= {};
  for (const area of Object.values(state.customAreas.areas)) {
    area.dropItemsIfInCombat ??= false;
    area.permissions = {
      pvp: area.permissions?.pvp ?? true,
      blockBreak: area.permissions?.blockBreak ?? true,
      blockBreakExceptions: [...new Set((area.permissions?.blockBreakExceptions ?? []).map((block) => block.trim().toLowerCase()).filter((block) => block.length > 0))],
      blockPlace: area.permissions?.blockPlace ?? true,
      blockPlaceExceptions: [...new Set((area.permissions?.blockPlaceExceptions ?? []).map((block) => block.trim().toLowerCase()).filter((block) => block.length > 0))],
      itemUse: area.permissions?.itemUse ?? true,
      entityInteract: area.permissions?.entityInteract ?? true,
    };
  }
  state.plots = normalizePlotStore(state.plots);
  const splitLootChests = loadLootChestsFromSplitKeys(dynamicPropertyIds);
  state.lootChests = splitLootChests.hasSplitData ? splitLootChests.store : readDynamicJSON<LootChestStore>(STORAGE_KEYS.lootChests, defaultLootChestStore());
  state.lootChests.config = { ...defaultLootChestStore().config, ...(state.lootChests.config ?? {}) };
  state.lootChests.pools ??= {};
  state.lootChests.snapshots ??= {};
  state.lootChests.chests ??= {};
  world.setDynamicProperty(STORAGE_KEYS.lootChests, undefined);
  state.commandBuilder = readDynamicJSON<CommandBuilderStore>(STORAGE_KEYS.commandBuilder, defaultCommandBuilderStore());
  state.commandBuilder.config = { ...defaultCommandBuilderStore().config, ...(state.commandBuilder.config ?? {}) };
  state.commandBuilder.commands ??= {};
  state.plots.config.autoBuild ??= defaultPlotStore().config.autoBuild;
  state.plots.config.autoBuild.roofBlock ??= defaultPlotStore().config.autoBuild.roofBlock;
  state.plots.config.autoBuild.roofHeight ??= defaultPlotStore().config.autoBuild.roofHeight;
  state.plots.config.saveIntervalTicks ??= defaultPlotStore().config.saveIntervalTicks;
  let cratesChanged = false;
  for (const crate of Object.values(state.crates.crates)) {
    const legacy = crate as typeof crate & { blockId?: string };
    if (!crate.crateBlockId && legacy.blockId) {
      crate.crateBlockId = legacy.blockId;
      delete legacy.blockId;
      cratesChanged = true;
    }
    const normalizedBlock = normalizeBlockId(crate.crateBlockId ?? "minecraft:gilded_blackstone");
    const normalizedKey = normalizeBlockId(crate.keyItemId ?? "minecraft:tripwire_hook");
    if (crate.crateBlockId !== normalizedBlock) {
      crate.crateBlockId = normalizedBlock;
      cratesChanged = true;
    }
    if (crate.keyItemId !== normalizedKey) {
      crate.keyItemId = normalizedKey;
      cratesChanged = true;
    }
    crate.animationPreset ??= "arcane";
    crate.particlePreset ??= "arcane";
  }
  if (cratesChanged) {
    safeSetDynamicJson(STORAGE_KEYS.crates, state.crates);
  }
}

// ---------------------------------------------------------------------------
// Re-exports — all moved symbols so consumers see them from "./state"
// ---------------------------------------------------------------------------

export { defaultConfig, defaultRankStore, defaultChatConfig, defaultPlayerStats, defaultPlotStore, defaultTpaStore, defaultHomeStore, defaultPayStore, defaultPlayerSettingsStore, defaultTeamStore, defaultPruneStore, defaultWarpStore, defaultGeneratorStore, defaultModerationStore, defaultCrateStore, defaultTauItemsStore, defaultCombatStore, defaultCommandBuilderStore, defaultPlayerShopStore, defaultCustomAreaStore, defaultLootChestStore } from "./defaults";
export { PLAYER_SHOPS_CONFIG_KEY, PLAYER_SHOPS_SHOP_PREFIX, PLAYER_SHOPS_LISTING_PREFIX, PLAYER_SHOPS_EARNINGS_PREFIX, CUSTOM_AREAS_CONFIG_KEY, CUSTOM_AREAS_AREA_PREFIX, LOOT_CHESTS_CONFIG_KEY, LOOT_CHESTS_POOL_PREFIX, LOOT_CHESTS_SNAPSHOT_PREFIX, LOOT_CHESTS_CHEST_PREFIX, PLOTS_CONFIG_KEY, PLOTS_SLOT_PREFIX, PLOTS_PLAYER_SLOT_PREFIX, PLOTS_SNAPSHOT_PREFIX, PLOTS_MIGRATION_MARKER_KEY, STATS_PLAYER_IDS_KEY, STATS_PLAYER_PREFIX, readSplitDynamicJson, clearSplitDynamicJson, writeSplitDynamicJson, safeSetDynamicJson, parseJSON } from "./dynamic-json";
export { markStatsPlayerDirty, markStatsPlayerIdsDirty } from "./split-keys/stats";
export { writePlayerShopsIncrementalToSplitKeys } from "./split-keys/player-shops";
export { writeCustomAreasToSplitKeys } from "./split-keys/custom-areas";
export { writeLootChestsToSplitKeys } from "./split-keys/loot-chests";
export { normalizePlotStore, writePlotsToSplitKeys, writePlotsIncrementalToSplitKeys } from "./split-keys/plots";
