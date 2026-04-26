import { EntityComponentTypes, PlayerPermissionLevel, system, world, } from "@minecraft/server";
import { CHAT_PREFIX, RESTRICTED_PLAYER_COMMANDS, STORAGE_KEYS, } from "./tau-models";
import { getPlayerTeam } from "./teams";
function defaultConfig() {
    return {
        features: {
            creator: true,
            forms: true,
            shops: true,
            sidebars: true,
            bindings: true,
            ranks: true,
            stats: true,
            profiles: true,
            plots: true,
            tpa: true,
            homes: true,
            pay: true,
            playerConfig: true,
            teams: true,
            prune: true,
            warps: true,
            plotTp: true,
            generators: true,
            crates: true,
            items: true,
            combat: true,
        },
    };
}
function defaultCombatStore() {
    return {
        config: {
            enabled: true,
            combatTimeSeconds: 15,
            announceLogouts: true,
            blockCommands: true,
            enterMessage: "§c» You are now in combat! Do not log out.",
            exitMessage: "§a» You are no longer in combat.",
            logoutBroadcastMessage: "§e[!] {player} quit while tagged and dropped their loot!",
            rejoinPenaltyMessage: "§4» Your items were dropped because you logged out during combat.",
            blockedCommandMessage: "§c» Commands are disabled while you are in combat.",
        },
    };
}
function defaultPlayerShopStore() {
    return {
        config: {
            enabled: true,
            defaultCurrencyObjective: "money",
            allowCustomItems: true,
            minPricePerUnit: 1,
            maxPricePerUnit: 1000000,
            taxPercent: 0,
            maxListingsPerShop: 32,
            defaultVisibility: "public",
            announceSales: true,
        },
        shops: {},
        listings: {},
        earningsByPlayerId: {},
    };
}
const PLAYER_SHOPS_CONFIG_KEY = `${STORAGE_KEYS.playerShops}:config`;
const PLAYER_SHOPS_SHOP_PREFIX = `${STORAGE_KEYS.playerShops}:shop:`;
const PLAYER_SHOPS_LISTING_PREFIX = `${STORAGE_KEYS.playerShops}:listing:`;
const PLAYER_SHOPS_EARNINGS_PREFIX = `${STORAGE_KEYS.playerShops}:earn:`;
const PLOTS_CONFIG_KEY = `${STORAGE_KEYS.plots}:config`;
const PLOTS_SLOT_PREFIX = `${STORAGE_KEYS.plots}:slot:`;
const PLOTS_PLAYER_SLOT_PREFIX = `${STORAGE_KEYS.plots}:player:`;
const PLOTS_SNAPSHOT_PREFIX = `${STORAGE_KEYS.plots}:snapshot:`;
const PLOTS_MIGRATION_MARKER_KEY = `${STORAGE_KEYS.plots}:migration_v2_done`;
const MAX_DYNAMIC_STRING_BYTES = 32000;
const STATS_PLAYER_IDS_KEY = "tau:stats:player_ids";
const STATS_PLAYER_PREFIX = "tau:stats:player:";
const dirtyStatsPlayerIds = new Set();
const dirtyStatsPlayers = new Set();
let statsFlushScheduled = false;
function estimateUtf8Bytes(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code <= 0x7f)
            bytes += 1;
        else if (code <= 0x7ff)
            bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
            bytes += 4;
            i++;
        }
        else
            bytes += 3;
    }
    return bytes;
}
function safeSetDynamicJson(key, value) {
    const serialized = JSON.stringify(value);
    if (estimateUtf8Bytes(serialized) > MAX_DYNAMIC_STRING_BYTES) {
        console.warn(`[TauUtils] DynamicProperty overflow blocked for key ${key}. Size exceeds ${MAX_DYNAMIC_STRING_BYTES} bytes.`);
        return false;
    }
    world.setDynamicProperty(key, serialized);
    return true;
}
function loadStatsFromSplitKeys() {
    const stats = { playerIds: {}, players: {} };
    let hasSplitData = false;
    const playerIdsRaw = world.getDynamicProperty(STATS_PLAYER_IDS_KEY);
    if (playerIdsRaw) {
        stats.playerIds = parseJSON(playerIdsRaw, {});
        hasSplitData = true;
    }
    for (const key of world.getDynamicPropertyIds()) {
        if (!key.startsWith(STATS_PLAYER_PREFIX))
            continue;
        const playerId = key.slice(STATS_PLAYER_PREFIX.length);
        if (!playerId)
            continue;
        const raw = world.getDynamicProperty(key);
        const parsed = parseJSON(raw, undefined);
        if (!parsed)
            continue;
        stats.players[playerId] = parsed;
        hasSplitData = true;
    }
    return { store: stats, hasSplitData };
}
function flushStatsNow() {
    if (dirtyStatsPlayerIds.size > 0) {
        safeSetDynamicJson(STATS_PLAYER_IDS_KEY, state.stats.playerIds);
        dirtyStatsPlayerIds.clear();
    }
    if (dirtyStatsPlayers.size > 0) {
        for (const playerId of dirtyStatsPlayers) {
            const stats = state.stats.players[playerId];
            if (!stats)
                continue;
            safeSetDynamicJson(`${STATS_PLAYER_PREFIX}${playerId}`, stats);
        }
        dirtyStatsPlayers.clear();
    }
    world.setDynamicProperty("tau:stats", undefined);
}
function scheduleStatsFlush() {
    if (statsFlushScheduled)
        return;
    statsFlushScheduled = true;
    system.runTimeout(() => {
        statsFlushScheduled = false;
        flushStatsNow();
    }, 20);
}
function markStatsPlayerDirty(playerId) {
    dirtyStatsPlayers.add(playerId);
    scheduleStatsFlush();
}
function markStatsPlayerIdsDirty() {
    dirtyStatsPlayerIds.add("playerIds");
    scheduleStatsFlush();
}
function loadPlayerShopsFromSplitKeys() {
    const base = defaultPlayerShopStore();
    let hasSplitData = false;
    const configRaw = world.getDynamicProperty(PLAYER_SHOPS_CONFIG_KEY);
    if (configRaw) {
        hasSplitData = true;
        const parsed = parseJSON(configRaw, {});
        base.config = { ...base.config, ...parsed };
    }
    const keys = world.getDynamicPropertyIds();
    for (const key of keys) {
        if (key.startsWith(PLAYER_SHOPS_SHOP_PREFIX)) {
            const raw = world.getDynamicProperty(key);
            const parsed = parseJSON(raw, undefined);
            if (!parsed || !parsed.id)
                continue;
            base.shops[parsed.id] = parsed;
            hasSplitData = true;
            continue;
        }
        if (key.startsWith(PLAYER_SHOPS_LISTING_PREFIX)) {
            const raw = world.getDynamicProperty(key);
            const parsed = parseJSON(raw, undefined);
            if (!parsed || !parsed.id)
                continue;
            base.listings[parsed.id] = parsed;
            hasSplitData = true;
            continue;
        }
        if (key.startsWith(PLAYER_SHOPS_EARNINGS_PREFIX)) {
            const playerId = key.slice(PLAYER_SHOPS_EARNINGS_PREFIX.length);
            if (!playerId)
                continue;
            const raw = world.getDynamicProperty(key);
            const parsed = parseJSON(raw, undefined);
            if (!parsed)
                continue;
            base.earningsByPlayerId[playerId] = parsed;
            hasSplitData = true;
            continue;
        }
    }
    return { store: base, hasSplitData };
}
function loadPlotsFromSplitKeys() {
    const base = defaultPlotStore();
    let hasSplitData = false;
    const configRaw = world.getDynamicProperty(PLOTS_CONFIG_KEY);
    if (configRaw) {
        const parsed = parseJSON(configRaw, {});
        base.config = { ...base.config, ...parsed };
        hasSplitData = true;
    }
    for (const key of world.getDynamicPropertyIds()) {
        if (key.startsWith(PLOTS_SLOT_PREFIX)) {
            const raw = world.getDynamicProperty(key);
            const parsed = parseJSON(raw, undefined);
            if (!parsed || !parsed.id)
                continue;
            base.slots[parsed.id] = parsed;
            hasSplitData = true;
            continue;
        }
        if (key.startsWith(PLOTS_PLAYER_SLOT_PREFIX)) {
            const playerId = key.slice(PLOTS_PLAYER_SLOT_PREFIX.length);
            if (!playerId)
                continue;
            const raw = world.getDynamicProperty(key);
            const slotId = parseJSON(raw, undefined);
            if (!slotId)
                continue;
            base.playerToSlot[playerId] = slotId;
            hasSplitData = true;
            continue;
        }
        if (key.startsWith(PLOTS_SNAPSHOT_PREFIX)) {
            const playerId = key.slice(PLOTS_SNAPSHOT_PREFIX.length);
            if (!playerId)
                continue;
            const raw = world.getDynamicProperty(key);
            const parsed = parseJSON(raw, undefined);
            if (!parsed)
                continue;
            base.snapshots[playerId] = parsed;
            hasSplitData = true;
            continue;
        }
    }
    return { store: base, hasSplitData };
}
function normalizePlotStore(input) {
    const defaults = defaultPlotStore();
    const config = input?.config ?? {};
    const autoBuild = config.autoBuild ?? {};
    return {
        config: {
            ...defaults.config,
            ...config,
            autoBuild: {
                ...defaults.config.autoBuild,
                ...autoBuild,
            },
        },
        slots: { ...(input?.slots ?? {}) },
        playerToSlot: { ...(input?.playerToSlot ?? {}) },
        snapshots: { ...(input?.snapshots ?? {}) },
    };
}
function writePlotsToSplitKeys(store) {
    const wantedSlotKeys = new Set();
    const wantedPlayerKeys = new Set();
    const wantedSnapshotKeys = new Set();
    let ok = true;
    ok = safeSetDynamicJson(PLOTS_CONFIG_KEY, store.config) && ok;
    for (const [slotId, slot] of Object.entries(store.slots)) {
        const key = `${PLOTS_SLOT_PREFIX}${slotId}`;
        wantedSlotKeys.add(key);
        ok = safeSetDynamicJson(key, slot) && ok;
    }
    for (const [playerId, slotId] of Object.entries(store.playerToSlot)) {
        const key = `${PLOTS_PLAYER_SLOT_PREFIX}${playerId}`;
        wantedPlayerKeys.add(key);
        ok = safeSetDynamicJson(key, slotId) && ok;
    }
    for (const [playerId, snapshot] of Object.entries(store.snapshots)) {
        const key = `${PLOTS_SNAPSHOT_PREFIX}${playerId}`;
        wantedSnapshotKeys.add(key);
        ok = safeSetDynamicJson(key, snapshot) && ok;
    }
    for (const key of world.getDynamicPropertyIds()) {
        if (key.startsWith(PLOTS_SLOT_PREFIX) && !wantedSlotKeys.has(key)) {
            world.setDynamicProperty(key, undefined);
            continue;
        }
        if (key.startsWith(PLOTS_PLAYER_SLOT_PREFIX) && !wantedPlayerKeys.has(key)) {
            world.setDynamicProperty(key, undefined);
            continue;
        }
        if (key.startsWith(PLOTS_SNAPSHOT_PREFIX) && !wantedSnapshotKeys.has(key)) {
            world.setDynamicProperty(key, undefined);
            continue;
        }
    }
    return ok;
}
// LEGACY_PLOTS_MIGRATION_REMOVE_AFTER_STABLE
function migrateLegacyPlotsToSplitOneShot() {
    const marker = world.getDynamicProperty(PLOTS_MIGRATION_MARKER_KEY);
    if (marker === true || marker === 1 || marker === "1")
        return { migrated: false, failed: false };
    const legacyRaw = world.getDynamicProperty(STORAGE_KEYS.plots);
    if (!legacyRaw) {
        world.setDynamicProperty(PLOTS_MIGRATION_MARKER_KEY, true);
        return { migrated: false, failed: false };
    }
    const legacyParsed = parseJSON(legacyRaw, undefined);
    if (!legacyParsed) {
        world.setDynamicProperty(STORAGE_KEYS.plots, undefined);
        world.setDynamicProperty(PLOTS_MIGRATION_MARKER_KEY, true);
        return { migrated: false, failed: false };
    }
    const legacy = normalizePlotStore(legacyParsed);
    const split = loadPlotsFromSplitKeys();
    const merged = split.hasSplitData
        ? {
            config: {
                ...legacy.config,
                ...split.store.config,
                autoBuild: {
                    ...legacy.config.autoBuild,
                    ...split.store.config.autoBuild,
                },
            },
            slots: { ...legacy.slots, ...split.store.slots },
            playerToSlot: { ...legacy.playerToSlot, ...split.store.playerToSlot },
            snapshots: { ...legacy.snapshots, ...split.store.snapshots },
        }
        : legacy;
    if (!writePlotsToSplitKeys(merged)) {
        console.warn("[TauUtils] Plot migration failed; keeping legacy tau:plots key for safety.");
        return { migrated: false, failed: true };
    }
    world.setDynamicProperty(STORAGE_KEYS.plots, undefined);
    world.setDynamicProperty(PLOTS_MIGRATION_MARKER_KEY, true);
    return { migrated: true, failed: false };
}
function defaultTauItemsStore() {
    return {
        config: {
            enabled: true,
        },
        items: {},
    };
}
function defaultCrateStore() {
    return {
        config: {
            enabled: true,
        },
        crates: {
            legendary: {
                id: "legendary",
                displayName: "Legendary Crate",
                keyItemId: "minecraft:tripwire_hook",
                keyLoreLine: "§6Legendary Key",
                crateBlockId: "minecraft:gilded_blackstone",
                animationPreset: "arcane",
                particlePreset: "arcane",
                broadcastRareWins: true,
                rareBroadcastWeightThreshold: 5,
                rewards: [
                    {
                        type: "item",
                        label: "Diamond x16",
                        weight: 100,
                        itemId: "minecraft:diamond",
                        amount: 16,
                    },
                    {
                        type: "item",
                        label: "Netherite Ingot x1",
                        weight: 10,
                        itemId: "minecraft:netherite_ingot",
                        amount: 1,
                    },
                    {
                        type: "item",
                        label: "Diamond Sword",
                        weight: 5,
                        itemId: "minecraft:diamond_sword",
                        amount: 1,
                        nameTag: "§bLegend Blade",
                    },
                    {
                        type: "score",
                        label: "$1000",
                        weight: 15,
                        objective: "money",
                        amount: 1000,
                    },
                    {
                        type: "tag",
                        label: "Legendary Winner Tag",
                        weight: 1,
                        tag: "tau.crate.legendary_winner",
                    },
                ],
            },
        },
        locations: {},
    };
}
function defaultGeneratorStore() {
    return {
        definitions: {},
        placed: {},
        config: {
            enabled: true,
            defaultPlaceAnywhere: true,
            blockOnPlotOnly: false,
            autoBreakersEnabled: true,
        },
    };
}
function defaultModerationStore() {
    return {
        bannedItems: [],
        inspectionSnapshots: {},
    };
}
function defaultTeamStore() {
    return {
        enabled: true,
        maxMembers: 10,
        teams: {},
        playerTeamIds: {},
    };
}
function defaultPruneStore() {
    return {
        config: {
            enabled: false,
            inactiveDays: 30,
            flags: {
                stats: true,
                profiles: true,
                teams: true,
                plots: true,
                homes: true,
                tpa: true,
                pay: true,
                playerSettings: true,
            },
        },
    };
}
function defaultWarpStore() {
    return {
        config: {
            enabled: true,
            maxWarps: 100,
            defaultPublic: true,
            crossDimension: true,
            cooldownSeconds: 5,
            categories: ["spawn", "pvp", "shop", "games"],
        },
        warps: {},
    };
}
function defaultTpaStore() {
    return {
        config: {
            enabled: true,
            timeoutSeconds: 60,
            cooldownSeconds: 20,
        },
    };
}
function defaultHomeStore() {
    return {
        config: {
            enabled: true,
            maxHomesDefault: 2,
            allowCrossDimension: false,
        },
        homesByPlayerId: {},
    };
}
function defaultPayStore() {
    return {
        config: {
            enabled: true,
            currencyObjective: "money",
            minAmount: 1,
            maxAmount: 100000,
            taxPercent: 0,
            cooldownSeconds: 1,
        },
    };
}
function defaultPlayerSettingsStore() {
    return {
        config: {
            enabled: true,
            defaultAllowTpa: true,
            defaultAllowPay: true,
            defaultShowSocialMessages: true,
        },
        players: {},
    };
}
function defaultPlotStore() {
    return {
        config: {
            enabled: false,
            activePlotCount: 10,
            size: { x: 20, y: 10, z: 20 },
            spacing: 4,
            dimensionId: "minecraft:overworld",
            origin: undefined,
            saveIntervalTicks: 20,
            autoBuild: {
                clearBase: true,
                addBorders: true,
                borderBlock: "stone",
                borderHeight: 1,
                floorBlock: undefined,
                roofBlock: "barrier",
                roofHeight: 3,
                showEnterTitle: false,
                titleRadius: 5,
                titleMode: "owner",
            },
        },
        slots: {},
        playerToSlot: {},
        snapshots: {},
    };
}
function defaultPlayerStats() {
    return {
        kills: 0,
        deaths: 0,
        killstreak: 0,
        longestKillstreak: 0,
        blocksPlaced: 0,
        blocksBroken: 0,
        timePlayed: 0,
        distanceTraveled: 0,
        lastSeenAt: 0,
    };
}
function defaultChatConfig() {
    return {
        enabled: true,
        template: "[name]: [rank] [message]",
    };
}
function defaultRankStore() {
    return {
        ranks: {
            member: {
                id: "member",
                name: "Member",
                priority: 0,
                color: "§f",
                permissions: [],
            },
        },
        playerRanks: {},
        defaultRankId: "member",
    };
}
export const state = {
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
};
export function tell(player, message) {
    player.sendMessage(`${CHAT_PREFIX} ${message}`);
}
export function normalizeKey(value) {
    return value.trim().toLowerCase();
}
export function findForm(menuId) {
    return (state.forms[menuId] ??
        Object.values(state.forms).find((form) => normalizeKey(form.id) === normalizeKey(menuId)));
}
export function findShopProfile(profileId) {
    return (state.shops[profileId] ??
        Object.values(state.shops).find((profile) => normalizeKey(profile.id) === normalizeKey(profileId)));
}
export function canonicalShopId(profileId) {
    return findShopProfile(profileId)?.id ?? profileId;
}
export function normalizeCategory(category) {
    return (category ?? "Uncategorized").trim() || "Uncategorized";
}
export function getOrCreateShopProfileCategoryList(profileId) {
    const profile = findShopProfile(profileId);
    if (!profile)
        return [];
    profile.categories ?? (profile.categories = []);
    return profile.categories;
}
export function getProfileCategories(profileId) {
    return getOrCreateShopProfileCategoryList(profileId);
}
export function getInventoryContainer(player) {
    const inv = player.getComponent(EntityComponentTypes.Inventory);
    if (!inv)
        return undefined;
    return inv.container;
}
export function countItemInContainer(player, typeId) {
    const container = getInventoryContainer(player);
    if (!container)
        return 0;
    let count = 0;
    for (let i = 0; i < container.size; i++) {
        const stack = container.getItem(i);
        if (!stack || stack.typeId !== typeId)
            continue;
        count += stack.amount;
    }
    return count;
}
export function removeItemFromContainer(player, typeId, amount) {
    const container = getInventoryContainer(player);
    if (!container)
        return false;
    let remaining = amount;
    for (let i = 0; i < container.size && remaining > 0; i++) {
        const stack = container.getItem(i);
        if (!stack || stack.typeId !== typeId)
            continue;
        if (stack.amount <= remaining) {
            remaining -= stack.amount;
            container.setItem(i, undefined);
        }
        else {
            stack.amount -= remaining;
            remaining = 0;
            container.setItem(i, stack);
        }
    }
    return remaining === 0;
}
export function getScore(player, objectiveId) {
    const objective = world.scoreboard.getObjective(objectiveId);
    if (!objective)
        return undefined;
    const identity = player.scoreboardIdentity;
    if (!identity)
        return 0;
    try {
        return objective.getScore(identity) ?? 0;
    }
    catch {
        return 0;
    }
}
export function setScore(player, objectiveId, value) {
    const objective = world.scoreboard.getObjective(objectiveId);
    if (!objective)
        return false;
    const identity = player.scoreboardIdentity;
    if (!identity)
        return false;
    objective.setScore(identity, value);
    return true;
}
export function applyTemplate(raw, player, selectedValue) {
    if (!raw)
        return "";
    return raw
        .split("{player}")
        .join(player.name)
        .split("{value}")
        .join(selectedValue === undefined ? "" : String(selectedValue));
}
export function parseJSON(raw, fallback) {
    if (!raw)
        return fallback;
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
export function loadState() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2;
    migrateLegacyPlotsToSplitOneShot();
    state.forms = parseJSON(world.getDynamicProperty(STORAGE_KEYS.forms), {});
    state.shops = parseJSON(world.getDynamicProperty(STORAGE_KEYS.shops), {});
    state.binds = parseJSON(world.getDynamicProperty(STORAGE_KEYS.binds), { itemBinds: {}, entityTagBinds: {} });
    state.sidebars = parseJSON(world.getDynamicProperty(STORAGE_KEYS.sidebars), { enabled: true, sidebars: {} });
    state.config = parseJSON(world.getDynamicProperty(STORAGE_KEYS.config), defaultConfig());
    (_a = state.config.features).combat ?? (_a.combat = defaultConfig().features.combat);
    state.ranks = parseJSON(world.getDynamicProperty(STORAGE_KEYS.ranks), defaultRankStore());
    state.chat = parseJSON(world.getDynamicProperty(STORAGE_KEYS.chat), defaultChatConfig());
    const splitStats = loadStatsFromSplitKeys();
    const legacyStats = parseJSON(world.getDynamicProperty("tau:stats"), { playerIds: {}, players: {} });
    state.stats = splitStats.hasSplitData ? splitStats.store : legacyStats;
    state.profiles = parseJSON(world.getDynamicProperty("tau:profiles"), { configs: {} });
    const splitPlots = loadPlotsFromSplitKeys();
    state.plots = splitPlots.hasSplitData ? normalizePlotStore(splitPlots.store) : defaultPlotStore();
    state.tpa = parseJSON(world.getDynamicProperty(STORAGE_KEYS.tpa), defaultTpaStore());
    state.homes = parseJSON(world.getDynamicProperty(STORAGE_KEYS.homes), defaultHomeStore());
    state.pay = parseJSON(world.getDynamicProperty(STORAGE_KEYS.pay), defaultPayStore());
    state.playerSettings = parseJSON(world.getDynamicProperty(STORAGE_KEYS.playerSettings), defaultPlayerSettingsStore());
    state.teams = parseJSON(world.getDynamicProperty(STORAGE_KEYS.teams), defaultTeamStore());
    state.prune = parseJSON(world.getDynamicProperty("tau:prune"), defaultPruneStore());
    state.warps = parseJSON(world.getDynamicProperty(STORAGE_KEYS.warps), defaultWarpStore());
    state.generators = parseJSON(world.getDynamicProperty(STORAGE_KEYS.generators), defaultGeneratorStore());
    let generatorsChanged = false;
    for (const def of Object.values(state.generators.definitions)) {
        const legacyDef = def;
        const legacyPurchased = Boolean(legacyDef.autoBreakerPurchased);
        const legacyEnabled = Boolean(legacyDef.autoBreakerEnabled);
        if (!legacyPurchased && !legacyEnabled)
            continue;
        const placements = Object.values(state.generators.placed).filter((placed) => placed.definitionId === def.id);
        if (placements.length > 0) {
            const target = placements.reduce((best, placed) => (placed.tier > best.tier ? placed : best), placements[0]);
            target.autoBreakerPurchased = legacyPurchased;
            target.autoBreakerEnabled = legacyPurchased && legacyEnabled;
            generatorsChanged = true;
        }
        delete legacyDef.autoBreakerPurchased;
        delete legacyDef.autoBreakerEnabled;
        generatorsChanged = true;
    }
    if (generatorsChanged)
        saveGenerators();
    state.moderation = parseJSON(world.getDynamicProperty(STORAGE_KEYS.moderation), defaultModerationStore());
    (_b = state.moderation).inspectionSnapshots ?? (_b.inspectionSnapshots = {});
    state.crates = parseJSON(world.getDynamicProperty(STORAGE_KEYS.crates), defaultCrateStore());
    state.tauItems = parseJSON(world.getDynamicProperty(STORAGE_KEYS.tauItems), defaultTauItemsStore());
    state.combat = parseJSON(world.getDynamicProperty(STORAGE_KEYS.combat), defaultCombatStore());
    (_c = state.combat.config).enabled ?? (_c.enabled = defaultCombatStore().config.enabled);
    (_d = state.combat.config).combatTimeSeconds ?? (_d.combatTimeSeconds = defaultCombatStore().config.combatTimeSeconds);
    (_e = state.combat.config).announceLogouts ?? (_e.announceLogouts = defaultCombatStore().config.announceLogouts);
    (_f = state.combat.config).blockCommands ?? (_f.blockCommands = defaultCombatStore().config.blockCommands);
    (_g = state.combat.config).enterMessage ?? (_g.enterMessage = defaultCombatStore().config.enterMessage);
    (_h = state.combat.config).exitMessage ?? (_h.exitMessage = defaultCombatStore().config.exitMessage);
    (_j = state.combat.config).logoutBroadcastMessage ?? (_j.logoutBroadcastMessage = defaultCombatStore().config.logoutBroadcastMessage);
    (_k = state.combat.config).rejoinPenaltyMessage ?? (_k.rejoinPenaltyMessage = defaultCombatStore().config.rejoinPenaltyMessage);
    (_l = state.combat.config).blockedCommandMessage ?? (_l.blockedCommandMessage = defaultCombatStore().config.blockedCommandMessage);
    const splitShops = loadPlayerShopsFromSplitKeys();
    const legacyPlayerShops = parseJSON(world.getDynamicProperty(STORAGE_KEYS.playerShops), defaultPlayerShopStore());
    state.playerShops = splitShops.hasSplitData ? splitShops.store : legacyPlayerShops;
    (_m = state.playerShops.config).enabled ?? (_m.enabled = defaultPlayerShopStore().config.enabled);
    (_o = state.playerShops.config).defaultCurrencyObjective ?? (_o.defaultCurrencyObjective = defaultPlayerShopStore().config.defaultCurrencyObjective);
    (_p = state.playerShops.config).allowCustomItems ?? (_p.allowCustomItems = defaultPlayerShopStore().config.allowCustomItems);
    (_q = state.playerShops.config).minPricePerUnit ?? (_q.minPricePerUnit = defaultPlayerShopStore().config.minPricePerUnit);
    (_r = state.playerShops.config).maxPricePerUnit ?? (_r.maxPricePerUnit = defaultPlayerShopStore().config.maxPricePerUnit);
    (_s = state.playerShops.config).taxPercent ?? (_s.taxPercent = defaultPlayerShopStore().config.taxPercent);
    (_t = state.playerShops.config).maxListingsPerShop ?? (_t.maxListingsPerShop = defaultPlayerShopStore().config.maxListingsPerShop);
    (_u = state.playerShops.config).defaultVisibility ?? (_u.defaultVisibility = defaultPlayerShopStore().config.defaultVisibility);
    (_v = state.playerShops.config).announceSales ?? (_v.announceSales = defaultPlayerShopStore().config.announceSales);
    (_w = state.playerShops).shops ?? (_w.shops = {});
    (_x = state.playerShops).listings ?? (_x.listings = {});
    (_y = state.playerShops).earningsByPlayerId ?? (_y.earningsByPlayerId = {});
    state.plots = normalizePlotStore(state.plots);
    (_z = state.plots.config).autoBuild ?? (_z.autoBuild = defaultPlotStore().config.autoBuild);
    (_0 = state.plots.config.autoBuild).roofBlock ?? (_0.roofBlock = defaultPlotStore().config.autoBuild.roofBlock);
    (_1 = state.plots.config.autoBuild).roofHeight ?? (_1.roofHeight = defaultPlotStore().config.autoBuild.roofHeight);
    (_2 = state.plots.config).saveIntervalTicks ?? (_2.saveIntervalTicks = defaultPlotStore().config.saveIntervalTicks);
    for (const crate of Object.values(state.crates.crates)) {
        crate.animationPreset ?? (crate.animationPreset = "arcane");
        crate.particlePreset ?? (crate.particlePreset = "arcane");
    }
}
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
export function normalizeItemId(value) {
    return String(value ?? "").trim().toLowerCase();
}
export function isFeatureEnabled(feature) {
    return state.config.features[feature] !== false;
}
export function clearAllData() {
    world.setDynamicProperty(STORAGE_KEYS.forms, undefined);
    world.setDynamicProperty(STORAGE_KEYS.shops, undefined);
    world.setDynamicProperty(STORAGE_KEYS.binds, undefined);
    world.setDynamicProperty(STORAGE_KEYS.sidebars, undefined);
    world.setDynamicProperty(STORAGE_KEYS.config, undefined);
    world.setDynamicProperty(STORAGE_KEYS.ranks, undefined);
    world.setDynamicProperty(STORAGE_KEYS.chat, undefined);
    world.setDynamicProperty("tau:stats", undefined);
    world.setDynamicProperty("tau:profiles", undefined);
    world.setDynamicProperty(STORAGE_KEYS.plots, undefined);
    world.setDynamicProperty(STORAGE_KEYS.tpa, undefined);
    world.setDynamicProperty(STORAGE_KEYS.homes, undefined);
    world.setDynamicProperty(STORAGE_KEYS.pay, undefined);
    world.setDynamicProperty(STORAGE_KEYS.playerSettings, undefined);
    world.setDynamicProperty(STORAGE_KEYS.teams, undefined);
    world.setDynamicProperty("tau:prune", undefined);
    world.setDynamicProperty(STORAGE_KEYS.warps, undefined);
    world.setDynamicProperty(STORAGE_KEYS.generators, undefined);
    world.setDynamicProperty(STORAGE_KEYS.moderation, undefined);
    world.setDynamicProperty(STORAGE_KEYS.crates, undefined);
    world.setDynamicProperty(STORAGE_KEYS.tauItems, undefined);
    world.setDynamicProperty(STORAGE_KEYS.combat, undefined);
    world.setDynamicProperty(STORAGE_KEYS.playerShops, undefined);
    world.setDynamicProperty(PLAYER_SHOPS_CONFIG_KEY, undefined);
    world.setDynamicProperty(PLOTS_CONFIG_KEY, undefined);
    world.setDynamicProperty(PLOTS_MIGRATION_MARKER_KEY, undefined);
    for (const key of world.getDynamicPropertyIds()) {
        if (key.startsWith(STATS_PLAYER_PREFIX) ||
            key === STATS_PLAYER_IDS_KEY ||
            key.startsWith(PLOTS_SLOT_PREFIX) ||
            key.startsWith(PLOTS_PLAYER_SLOT_PREFIX) ||
            key.startsWith(PLOTS_SNAPSHOT_PREFIX) ||
            key.startsWith(PLAYER_SHOPS_SHOP_PREFIX) ||
            key.startsWith(PLAYER_SHOPS_LISTING_PREFIX) ||
            key.startsWith(PLAYER_SHOPS_EARNINGS_PREFIX)) {
            world.setDynamicProperty(key, undefined);
        }
    }
    state.forms = {};
    state.shops = {};
    state.binds = { itemBinds: {}, entityTagBinds: {} };
    state.sidebars = { enabled: true, sidebars: {} };
    state.config = defaultConfig();
    state.ranks = defaultRankStore();
    state.chat = defaultChatConfig();
    state.stats = { playerIds: {}, players: {} };
    state.profiles = { configs: {} };
    state.plots = defaultPlotStore();
    state.tpa = defaultTpaStore();
    state.homes = defaultHomeStore();
    state.pay = defaultPayStore();
    state.playerSettings = defaultPlayerSettingsStore();
    state.teams = defaultTeamStore();
    state.prune = defaultPruneStore();
    state.warps = defaultWarpStore();
    state.generators = defaultGeneratorStore();
    state.moderation = defaultModerationStore();
    state.crates = defaultCrateStore();
    state.tauItems = defaultTauItemsStore();
    state.combat = defaultCombatStore();
    state.playerShops = defaultPlayerShopStore();
}
export function asPlayer(entity) {
    if (!entity || entity.typeId !== "minecraft:player")
        return undefined;
    return entity;
}
export function isOperator(player) {
    return player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
}
export function sanitizePlayerCommand(command) {
    const token = command
        .replace(/^\//, "")
        .trim()
        .split(/\s+/)[0]
        ?.toLowerCase();
    if (!token)
        return false;
    return !RESTRICTED_PLAYER_COMMANDS.has(token);
}
export function commandStripSlash(value) {
    return value.startsWith("/") ? value.slice(1) : value;
}
export function normalizeForSudo(command, player) {
    const safeName = player.name.replace(/"/g, '\\"');
    return command.replace(/@s/g, `@a[name="${safeName}"]`);
}
export function commandOriginToPlayer(origin) {
    return asPlayer(origin.sourceEntity) ?? asPlayer(origin.initiator);
}
export function getMenuIdFromTags(tags) {
    for (const tag of tags) {
        const menuIdPrefix = /^menuid:(.+)$/i.exec(tag);
        if (menuIdPrefix)
            return menuIdPrefix[1].trim();
        const menuIdEqual = /^menuid=(.+)$/i.exec(tag);
        if (menuIdEqual)
            return menuIdEqual[1].trim();
        const menuPrefix = /^menu:(.+)$/i.exec(tag);
        if (menuPrefix)
            return menuPrefix[1].trim();
    }
    return undefined;
}
export function getMenuIdFromNameTag(nameTag) {
    if (!nameTag)
        return undefined;
    const trimmed = nameTag.trim();
    if (trimmed.toLowerCase().startsWith("menuid:")) {
        return trimmed.slice(7).trim();
    }
    if (trimmed.toLowerCase().startsWith("menu:")) {
        return trimmed.slice(5).trim();
    }
    return undefined;
}
export function getRankById(rankId) {
    return state.ranks.ranks[rankId];
}
export function getPlayerRank(playerName) {
    const rankId = state.ranks.playerRanks[playerName];
    if (rankId) {
        const rank = getRankById(rankId);
        if (rank)
            return rank;
    }
    const defaultId = state.ranks.defaultRankId;
    if (defaultId)
        return getRankById(defaultId);
    return undefined;
}
export function setDefaultRank(rankId) {
    if (!getRankById(rankId))
        return false;
    state.ranks.defaultRankId = rankId;
    saveRanks();
    return true;
}
export function assignRank(playerName, rankId) {
    if (!getRankById(rankId))
        return false;
    state.ranks.playerRanks[playerName] = rankId;
    saveRanks();
    return true;
}
export function removeRank(playerName) {
    if (!state.ranks.playerRanks[playerName])
        return false;
    delete state.ranks.playerRanks[playerName];
    saveRanks();
    return true;
}
export function hasPermission(player, permission) {
    if (isOperator(player))
        return true;
    const rank = getPlayerRank(player.name);
    if (!rank || rank.permissions.length === 0)
        return false;
    const perm = permission.toLowerCase();
    for (const p of rank.permissions) {
        const lower = p.toLowerCase();
        if (lower === "*")
            return true;
        if (lower === perm)
            return true;
        if (lower.endsWith("*")) {
            const prefix = lower.slice(0, -1);
            if (perm.startsWith(prefix))
                return true;
        }
    }
    return false;
}
export function formatChatMessage(player, message) {
    if (!state.chat.enabled)
        return `${player.name}: ${message}`;
    const rank = getPlayerRank(player.name);
    const template = rank?.chatFormat ?? state.chat.template;
    const rankName = rank ? `${rank.color}${rank.name}§r` : "";
    const rankPrefix = rank?.prefix ?? "";
    const rankSuffix = rank?.suffix ?? "";
    const team = getPlayerTeam(player);
    const teamTag = team ? `${team.color}[${team.tag}]§r` : "";
    const money = getScore(player, "money") ?? 0;
    let result = template;
    result = result.replace(/\[name\]/g, player.name);
    result = result.replace(/\[rank\]/g, rankName);
    result = result.replace(/\[rank_prefix\]/g, rankPrefix);
    result = result.replace(/\[rank_suffix\]/g, rankSuffix);
    result = result.replace(/\[team\]/g, teamTag);
    result = result.replace(/\[money\]/g, String(money));
    result = result.replace(/\[message\]/g, message);
    return result;
}
export function getPlayerId(player) {
    var _a;
    const existing = state.stats.playerIds[player.name];
    if (existing)
        return existing;
    const rawId = player.id || player.name;
    const generated = `tau-${normalizeKey(rawId).replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
    state.stats.playerIds[player.name] = generated;
    (_a = state.stats.players)[generated] ?? (_a[generated] = defaultPlayerStats());
    markStatsPlayerIdsDirty();
    markStatsPlayerDirty(generated);
    return generated;
}
export function getPlayerStats(player) {
    var _a;
    const id = getPlayerId(player);
    (_a = state.stats.players)[id] ?? (_a[id] = defaultPlayerStats());
    state.stats.players[id].lastSeenAt = Date.now();
    return state.stats.players[id];
}
export function incrementStat(player, key, amount = 1) {
    const id = getPlayerId(player);
    const stats = getPlayerStats(player);
    stats[key] = (stats[key] ?? 0) + amount;
    markStatsPlayerDirty(id);
    return stats[key];
}
export function setStat(player, key, value) {
    const id = getPlayerId(player);
    const stats = getPlayerStats(player);
    stats[key] = value;
    markStatsPlayerDirty(id);
}
export function resetStats(player) {
    const id = getPlayerId(player);
    state.stats.players[id] = defaultPlayerStats();
    markStatsPlayerDirty(id);
}
export function getPlayerStatsById(playerId) {
    var _a;
    (_a = state.stats.players)[playerId] ?? (_a[playerId] = defaultPlayerStats());
    if (state.stats.players[playerId].lastSeenAt === 0)
        state.stats.players[playerId].lastSeenAt = Date.now();
    return state.stats.players[playerId];
}
export function getProfileConfig(playerId) {
    var _a;
    (_a = state.profiles.configs)[playerId] ?? (_a[playerId] = {
        enabled: true,
        sections: ["summary", "stats", "rank"],
        customFields: [],
    });
    return state.profiles.configs[playerId];
}
export function setProfileConfig(playerId, config) {
    state.profiles.configs[playerId] = {
        enabled: config.enabled,
        sections: config.sections,
        customFields: config.customFields,
    };
    saveProfiles();
}
export function setPlayerStatById(playerId, key, value) {
    var _a;
    (_a = state.stats.players)[playerId] ?? (_a[playerId] = defaultPlayerStats());
    state.stats.players[playerId][key] = value;
    markStatsPlayerDirty(playerId);
}
export function getKnownPlayerIds() {
    return Object.values(state.stats.playerIds);
}
