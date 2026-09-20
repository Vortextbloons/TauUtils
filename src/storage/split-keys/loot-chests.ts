import { world } from "@minecraft/server";
import { serializeDynamicJson, setDynamicJsonIfChanged, clearPersistedDynamicKey, LOOT_CHESTS_CONFIG_KEY, LOOT_CHESTS_POOL_PREFIX, LOOT_CHESTS_SNAPSHOT_PREFIX, LOOT_CHESTS_CHEST_PREFIX, parseJSON } from "../dynamic-json";
import { type LootChestLocation, type LootChestPool, type LootChestSnapshot, type LootChestStore } from "../../types";
import { defaultLootChestStore } from "../defaults";

const persistedLootChestJsonByKey = new Map<string, string>();

export function loadLootChestsFromSplitKeys(dynamicPropertyIds: string[]): { store: LootChestStore; hasSplitData: boolean } {
  const base = defaultLootChestStore();
  let hasSplitData = false;
  persistedLootChestJsonByKey.clear();
  const configRaw = world.getDynamicProperty(LOOT_CHESTS_CONFIG_KEY) as string | undefined;
  if (configRaw) {
    base.config = { ...base.config, ...parseJSON<Partial<LootChestStore["config"]>>(configRaw, {}) };
    persistedLootChestJsonByKey.set(LOOT_CHESTS_CONFIG_KEY, configRaw);
    hasSplitData = true;
  }
  for (const key of dynamicPropertyIds) {
    if (key.startsWith(LOOT_CHESTS_POOL_PREFIX)) {
      const raw = world.getDynamicProperty(key) as string | undefined;
      const parsed = parseJSON<LootChestPool | undefined>(raw, undefined);
      if (!parsed?.id) continue;
      parsed.snapshotIds ??= [];
      parsed.enabled ??= true;
      base.pools[parsed.id] = parsed;
      if (raw) persistedLootChestJsonByKey.set(key, raw);
      hasSplitData = true;
      continue;
    }
    if (key.startsWith(LOOT_CHESTS_SNAPSHOT_PREFIX)) {
      const raw = world.getDynamicProperty(key) as string | undefined;
      const parsed = parseJSON<LootChestSnapshot | undefined>(raw, undefined);
      if (!parsed?.id || !parsed.poolId) continue;
      parsed.items ??= [];
      parsed.enabled ??= true;
      base.snapshots[`${parsed.poolId}:${parsed.id}`] = parsed;
      if (raw) persistedLootChestJsonByKey.set(key, raw);
      hasSplitData = true;
      continue;
    }
    if (key.startsWith(LOOT_CHESTS_CHEST_PREFIX)) {
      const raw = world.getDynamicProperty(key) as string | undefined;
      const parsed = parseJSON<LootChestLocation | undefined>(raw, undefined);
      if (!parsed?.id || !parsed.poolId) continue;
      parsed.name ??= parsed.id;
      parsed.enabled ??= true;
      if (parsed.refillMode === "empty_only" || parsed.refillMode === undefined) parsed.refillMode = "open";
      if (parsed.refillMode === "open") {
        parsed.nextRefillAt = Number.POSITIVE_INFINITY;
        parsed.emptySinceAt = undefined;
      }
      parsed.preserveSlots ??= true;
      parsed.refillMessageEnabled ??= false;
      parsed.refillMessage ??= "§aLoot chest refilled at [x] [y] [z].";
      parsed.broadcastRefillMessage ??= false;
      parsed.refillCommandsEnabled ??= false;
      parsed.refillCommands ??= [];
      base.chests[parsed.id] = parsed;
      if (raw) persistedLootChestJsonByKey.set(key, raw);
      hasSplitData = true;
    }
  }
  return { store: base, hasSplitData };
}

export function rememberLootChestSplitKeys(store: LootChestStore): void {
  persistedLootChestJsonByKey.clear();
  const config = serializeDynamicJson(LOOT_CHESTS_CONFIG_KEY, store.config);
  if (config !== undefined) persistedLootChestJsonByKey.set(LOOT_CHESTS_CONFIG_KEY, config);
  for (const [poolId, pool] of Object.entries(store.pools)) {
    const key = `${LOOT_CHESTS_POOL_PREFIX}${poolId}`;
    const serialized = serializeDynamicJson(key, pool);
    if (serialized !== undefined) persistedLootChestJsonByKey.set(key, serialized);
  }
  for (const snapshot of Object.values(store.snapshots)) {
    const key = `${LOOT_CHESTS_SNAPSHOT_PREFIX}${snapshot.poolId}:${snapshot.id}`;
    const serialized = serializeDynamicJson(key, snapshot);
    if (serialized !== undefined) persistedLootChestJsonByKey.set(key, serialized);
  }
  for (const [chestId, chest] of Object.entries(store.chests)) {
    const key = `${LOOT_CHESTS_CHEST_PREFIX}${chestId}`;
    const serialized = serializeDynamicJson(key, chest);
    if (serialized !== undefined) persistedLootChestJsonByKey.set(key, serialized);
  }
}

export function writeLootChestsToSplitKeys(store: LootChestStore): boolean {
  let ok = true;
  const wantedKeys = new Set<string>();

  wantedKeys.add(LOOT_CHESTS_CONFIG_KEY);
  ok = setDynamicJsonIfChanged(LOOT_CHESTS_CONFIG_KEY, store.config, persistedLootChestJsonByKey) && ok;

  for (const [poolId, pool] of Object.entries(store.pools)) {
    const key = `${LOOT_CHESTS_POOL_PREFIX}${poolId}`;
    wantedKeys.add(key);
    ok = setDynamicJsonIfChanged(key, pool, persistedLootChestJsonByKey) && ok;
  }
  for (const snapshot of Object.values(store.snapshots)) {
    const key = `${LOOT_CHESTS_SNAPSHOT_PREFIX}${snapshot.poolId}:${snapshot.id}`;
    wantedKeys.add(key);
    ok = setDynamicJsonIfChanged(key, snapshot, persistedLootChestJsonByKey) && ok;
  }
  for (const [chestId, chest] of Object.entries(store.chests)) {
    const key = `${LOOT_CHESTS_CHEST_PREFIX}${chestId}`;
    wantedKeys.add(key);
    ok = setDynamicJsonIfChanged(key, chest, persistedLootChestJsonByKey) && ok;
  }

  // GC only over keys we previously persisted; no world.getDynamicPropertyIds() scan.
  for (const key of [...persistedLootChestJsonByKey.keys()]) {
    if (!wantedKeys.has(key)) clearPersistedDynamicKey(key, persistedLootChestJsonByKey);
  }

  return ok;
}
