import { world } from "@minecraft/server";
import { serializeDynamicJson, setDynamicJsonIfChanged, clearPersistedDynamicKey, safeSetDynamicJson, PLOTS_CONFIG_KEY, PLOTS_SLOT_PREFIX, PLOTS_PLAYER_SLOT_PREFIX, PLOTS_SNAPSHOT_PREFIX, PLOTS_MIGRATION_MARKER_KEY, parseJSON } from "../dynamic-json";
import { STORAGE_KEYS } from "../../types";
import { type PlotStore } from "../../types";
import { defaultPlotStore } from "../defaults";

const persistedPlotJsonByKey = new Map<string, string>();

export function loadPlotsFromSplitKeys(dynamicPropertyIds: string[] = world.getDynamicPropertyIds()): { store: PlotStore; hasSplitData: boolean } {
  const base = defaultPlotStore();
  let hasSplitData = false;

  const configRaw = world.getDynamicProperty(PLOTS_CONFIG_KEY) as string | undefined;
  if (configRaw) {
    const parsed = parseJSON<Partial<PlotStore["config"]>>(configRaw, {});
    base.config = { ...base.config, ...parsed };
    hasSplitData = true;
  }

  for (const key of dynamicPropertyIds) {
    if (key.startsWith(PLOTS_SLOT_PREFIX)) {
      const raw = world.getDynamicProperty(key) as string | undefined;
      const parsed = parseJSON<PlotStore["slots"][string] | undefined>(raw, undefined);
      if (!parsed || !parsed.id) continue;
      base.slots[parsed.id] = parsed;
      hasSplitData = true;
      continue;
    }
    if (key.startsWith(PLOTS_PLAYER_SLOT_PREFIX)) {
      const playerId = key.slice(PLOTS_PLAYER_SLOT_PREFIX.length);
      if (!playerId) continue;
      const raw = world.getDynamicProperty(key) as string | undefined;
      const slotId = parseJSON<string | undefined>(raw, undefined);
      if (!slotId) continue;
      base.playerToSlot[playerId] = slotId;
      hasSplitData = true;
      continue;
    }
    if (key.startsWith(PLOTS_SNAPSHOT_PREFIX)) {
      const playerId = key.slice(PLOTS_SNAPSHOT_PREFIX.length);
      if (!playerId) continue;
      const raw = world.getDynamicProperty(key) as string | undefined;
      const parsed = parseJSON<PlotStore["snapshots"][string] | undefined>(raw, undefined);
      if (!parsed) continue;
      base.snapshots[playerId] = parsed;
      hasSplitData = true;
      continue;
    }
  }

  return { store: base, hasSplitData };
}

export function normalizePlotStore(input?: Partial<PlotStore>): PlotStore {
  const defaults = defaultPlotStore();
  const config = input?.config ?? {};
  const autoBuild = (config as Partial<PlotStore["config"]>).autoBuild ?? {};
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

export function writePlotsToSplitKeys(store: PlotStore): boolean {
  const wantedSlotKeys = new Set<string>();
  const wantedPlayerKeys = new Set<string>();
  const wantedSnapshotKeys = new Set<string>();
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

export function rememberPlotSplitKeys(store: PlotStore): void {
  persistedPlotJsonByKey.clear();
  const config = serializeDynamicJson(PLOTS_CONFIG_KEY, store.config);
  if (config !== undefined) persistedPlotJsonByKey.set(PLOTS_CONFIG_KEY, config);
  for (const [slotId, slot] of Object.entries(store.slots)) {
    const key = `${PLOTS_SLOT_PREFIX}${slotId}`;
    const serialized = serializeDynamicJson(key, slot);
    if (serialized !== undefined) persistedPlotJsonByKey.set(key, serialized);
  }
  for (const [playerId, slotId] of Object.entries(store.playerToSlot)) {
    const key = `${PLOTS_PLAYER_SLOT_PREFIX}${playerId}`;
    const serialized = serializeDynamicJson(key, slotId);
    if (serialized !== undefined) persistedPlotJsonByKey.set(key, serialized);
  }
  for (const [playerId, snapshot] of Object.entries(store.snapshots)) {
    const key = `${PLOTS_SNAPSHOT_PREFIX}${playerId}`;
    const serialized = serializeDynamicJson(key, snapshot);
    if (serialized !== undefined) persistedPlotJsonByKey.set(key, serialized);
  }
}

export function writePlotsIncrementalToSplitKeys(store: PlotStore): boolean {
  let ok = true;
  const wantedKeys = new Set<string>();

  wantedKeys.add(PLOTS_CONFIG_KEY);
  ok = setDynamicJsonIfChanged(PLOTS_CONFIG_KEY, store.config, persistedPlotJsonByKey) && ok;

  for (const [slotId, slot] of Object.entries(store.slots)) {
    const key = `${PLOTS_SLOT_PREFIX}${slotId}`;
    wantedKeys.add(key);
    ok = setDynamicJsonIfChanged(key, slot, persistedPlotJsonByKey) && ok;
  }
  for (const [playerId, slotId] of Object.entries(store.playerToSlot)) {
    const key = `${PLOTS_PLAYER_SLOT_PREFIX}${playerId}`;
    wantedKeys.add(key);
    ok = setDynamicJsonIfChanged(key, slotId, persistedPlotJsonByKey) && ok;
  }
  for (const [playerId, snapshot] of Object.entries(store.snapshots)) {
    const key = `${PLOTS_SNAPSHOT_PREFIX}${playerId}`;
    wantedKeys.add(key);
    ok = setDynamicJsonIfChanged(key, snapshot, persistedPlotJsonByKey) && ok;
  }

  for (const key of [...persistedPlotJsonByKey.keys()]) {
    if (!wantedKeys.has(key)) clearPersistedDynamicKey(key, persistedPlotJsonByKey);
  }

  return ok;
}

// LEGACY_PLOTS_MIGRATION_REMOVE_AFTER_STABLE
export function migrateLegacyPlotsToSplitOneShot(): { migrated: boolean; failed: boolean } {
  const marker = world.getDynamicProperty(PLOTS_MIGRATION_MARKER_KEY);
  if (marker === true || marker === 1 || marker === "1") return { migrated: false, failed: false };

  const legacyRaw = world.getDynamicProperty(STORAGE_KEYS.plots) as string | undefined;
  if (!legacyRaw) {
    world.setDynamicProperty(PLOTS_MIGRATION_MARKER_KEY, true);
    return { migrated: false, failed: false };
  }

  const legacyParsed = parseJSON<PlotStore | undefined>(legacyRaw, undefined);
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
