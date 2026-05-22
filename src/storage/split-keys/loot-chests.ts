import { world } from "@minecraft/server";
import { safeSetDynamicJson, LOOT_CHESTS_CONFIG_KEY, LOOT_CHESTS_POOL_PREFIX, LOOT_CHESTS_SNAPSHOT_PREFIX, LOOT_CHESTS_CHEST_PREFIX, parseJSON } from "../dynamic-json";
import { type LootChestLocation, type LootChestPool, type LootChestSnapshot, type LootChestStore } from "../../types";
import { defaultLootChestStore } from "../defaults";

export function loadLootChestsFromSplitKeys(dynamicPropertyIds: string[]): { store: LootChestStore; hasSplitData: boolean } {
  const base = defaultLootChestStore();
  let hasSplitData = false;
  const configRaw = world.getDynamicProperty(LOOT_CHESTS_CONFIG_KEY) as string | undefined;
  if (configRaw) {
    base.config = { ...base.config, ...parseJSON<Partial<LootChestStore["config"]>>(configRaw, {}) };
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
      hasSplitData = true;
    }
  }
  return { store: base, hasSplitData };
}

export function writeLootChestsToSplitKeys(store: LootChestStore): boolean {
  let ok = safeSetDynamicJson(LOOT_CHESTS_CONFIG_KEY, store.config);
  const wantedKeys = new Set<string>([LOOT_CHESTS_CONFIG_KEY]);
  for (const [poolId, pool] of Object.entries(store.pools)) {
    const key = `${LOOT_CHESTS_POOL_PREFIX}${poolId}`;
    wantedKeys.add(key);
    ok = safeSetDynamicJson(key, pool) && ok;
  }
  for (const snapshot of Object.values(store.snapshots)) {
    const key = `${LOOT_CHESTS_SNAPSHOT_PREFIX}${snapshot.poolId}:${snapshot.id}`;
    wantedKeys.add(key);
    ok = safeSetDynamicJson(key, snapshot) && ok;
  }
  for (const [chestId, chest] of Object.entries(store.chests)) {
    const key = `${LOOT_CHESTS_CHEST_PREFIX}${chestId}`;
    wantedKeys.add(key);
    ok = safeSetDynamicJson(key, chest) && ok;
  }
  for (const key of world.getDynamicPropertyIds()) {
    if (key.startsWith(LOOT_CHESTS_POOL_PREFIX) && !wantedKeys.has(key)) world.setDynamicProperty(key, undefined);
    if (key.startsWith(LOOT_CHESTS_SNAPSHOT_PREFIX) && !wantedKeys.has(key)) world.setDynamicProperty(key, undefined);
    if (key.startsWith(LOOT_CHESTS_CHEST_PREFIX) && !wantedKeys.has(key)) world.setDynamicProperty(key, undefined);
  }
  return ok;
}
