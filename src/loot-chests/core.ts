import { Block, BlockComponentTypes, BlockInventoryComponent, Player, system, world, type Vector3 } from "@minecraft/server";
import { isFeatureEnabled, isOperator, saveLootChests, state, tell } from "../storage";
import { deserializeItemStack, serializeItemStack } from "../shared/item-serialization";
import { renderCommandTemplate, renderTemplate } from "../shared/templates";
import type { LootChestLocation, LootChestPool, LootChestRefillMode, LootChestSnapshot, LootChestSnapshotItem } from "../types";

type ContainerLike = {
  size: number;
  getItem(slot: number): ReturnType<typeof deserializeItemStack> | undefined;
  setItem(slot: number, item?: ReturnType<typeof deserializeItemStack>): void;
};

type LocationInput = {
  dimensionId: string;
  x: number;
  y: number;
  z: number;
};

type RefillResult = {
  ok: boolean;
  message: string;
  savedChange?: boolean;
};

type RuntimeCache = {
  enabledChests: LootChestLocation[];
  earliestDueAt: number;
  snapshotsByPoolId: Map<string, LootChestSnapshot[]>;
};

let runtimeCache: RuntimeCache | undefined;
let processCursor = 0;

function nowMs(): number {
  return Date.now();
}

function normalizeId(value: string): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function locationKey(location: LocationInput): string {
  return `${location.dimensionId}:${Math.floor(location.x)}:${Math.floor(location.y)}:${Math.floor(location.z)}`;
}

function snapshotKey(poolId: string, snapshotId: string): string {
  return `${poolId}:${snapshotId}`;
}

function getBlockAt(location: LocationInput): Block | undefined {
  try {
    return world.getDimension(location.dimensionId).getBlock({
      x: Math.floor(location.x),
      y: Math.floor(location.y),
      z: Math.floor(location.z),
    });
  } catch {
    return undefined;
  }
}

function getContainerAt(location: LocationInput): ContainerLike | undefined {
  const block = getBlockAt(location);
  if (!block) return undefined;
  try {
    const inventory = block.getComponent(BlockComponentTypes.Inventory) as BlockInventoryComponent | undefined;
    return inventory?.container as ContainerLike | undefined;
  } catch {
    return undefined;
  }
}

function isContainerEmpty(container: ContainerLike): boolean {
  for (let slot = 0; slot < container.size; slot++) {
    if (container.getItem(slot)) return false;
  }
  return true;
}

function clearContainer(container: ContainerLike): void {
  for (let slot = 0; slot < container.size; slot++) {
    container.setItem(slot, undefined);
  }
}

function serializeContainer(container: ContainerLike): LootChestSnapshotItem[] {
  const items: LootChestSnapshotItem[] = [];
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (!stack) continue;
    items.push({ slot, item: serializeItemStack(stack) });
  }
  return items;
}

function placeInFirstEmptySlot(container: ContainerLike, item: ReturnType<typeof deserializeItemStack>): boolean {
  for (let slot = 0; slot < container.size; slot++) {
    if (container.getItem(slot)) continue;
    container.setItem(slot, item);
    return true;
  }
  return false;
}

function restoreSnapshotToContainer(snapshot: LootChestSnapshot, container: ContainerLike, preserveSlots: boolean): number {
  let placed = 0;
  clearContainer(container);
  for (const entry of snapshot.items) {
    let stack: ReturnType<typeof deserializeItemStack>;
    try {
      stack = deserializeItemStack(entry.item);
    } catch {
      continue;
    }

    if (preserveSlots && entry.slot >= 0 && entry.slot < container.size && !container.getItem(entry.slot)) {
      container.setItem(entry.slot, stack);
      placed++;
      continue;
    }

    if (placeInFirstEmptySlot(container, stack)) placed++;
  }
  return placed;
}

function getRefillTemplateExtra(chest: LootChestLocation, snapshot: LootChestSnapshot, placed: number): Record<string, string | number | boolean | undefined> {
  const pool = state.lootChests.pools[chest.poolId];
  return {
    chest: chest.id,
    pool: pool?.name ?? chest.poolId,
    pool_id: chest.poolId,
    snapshot: snapshot.name,
    snapshot_id: snapshot.id,
    items: placed,
    x: chest.x,
    y: chest.y,
    z: chest.z,
    dimension: chest.dimensionId,
  };
}

function runRefillSideEffects(chest: LootChestLocation, snapshot: LootChestSnapshot, placed: number): void {
  const extra = getRefillTemplateExtra(chest, snapshot, placed);
  if (chest.refillMessageEnabled && chest.refillMessage) {
    const message = renderTemplate(chest.refillMessage, { extra });
    if (message) {
      if (chest.broadcastRefillMessage) world.sendMessage(message);
      else {
        try {
          world.getDimension(chest.dimensionId).runCommand(`tellraw @a[x=${chest.x},y=${chest.y},z=${chest.z},r=24] ${JSON.stringify({ rawtext: [{ text: message }] })}`);
        } catch {
        }
      }
    }
  }

  if (!chest.refillCommandsEnabled || !chest.refillCommands || chest.refillCommands.length === 0) return;
  const commands = chest.refillCommands.slice(0, 10);
  try {
    const dimension = world.getDimension(chest.dimensionId);
    for (const raw of commands) {
      const command = renderCommandTemplate(raw, { extra });
      if (!command) continue;
      try {
        dimension.runCommand(command);
      } catch {
      }
    }
  } catch {
  }
}

function chooseWeightedSnapshot(snapshots: LootChestSnapshot[]): LootChestSnapshot | undefined {
  const valid = snapshots.filter((snapshot) => snapshot.enabled && Number.isFinite(snapshot.weight) && snapshot.weight > 0 && snapshot.items.length > 0);
  if (valid.length === 0) return undefined;
  const total = valid.reduce((sum, snapshot) => sum + snapshot.weight, 0);
  let roll = Math.random() * total;
  for (const snapshot of valid) {
    roll -= snapshot.weight;
    if (roll <= 0) return snapshot;
  }
  return valid[valid.length - 1];
}

function buildRuntimeCache(): RuntimeCache {
  const snapshotsByPoolId = new Map<string, LootChestSnapshot[]>();
  for (const snapshot of Object.values(state.lootChests.snapshots)) {
    const list = snapshotsByPoolId.get(snapshot.poolId) ?? [];
    list.push(snapshot);
    snapshotsByPoolId.set(snapshot.poolId, list);
  }
  const enabledChests = Object.values(state.lootChests.chests)
    .filter((chest) => chest.enabled)
    .sort((a, b) => a.nextRefillAt - b.nextRefillAt || a.id.localeCompare(b.id));
  return {
    enabledChests,
    earliestDueAt: enabledChests[0]?.nextRefillAt ?? Number.POSITIVE_INFINITY,
    snapshotsByPoolId,
  };
}

function getRuntimeCache(): RuntimeCache {
  if (!runtimeCache) runtimeCache = buildRuntimeCache();
  return runtimeCache;
}

export function invalidateLootChestRuntimeCache(): void {
  runtimeCache = undefined;
}

export function listLootChestPools(): LootChestPool[] {
  return Object.values(state.lootChests.pools).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function listLootChestSnapshots(poolId: string): LootChestSnapshot[] {
  const id = normalizeId(poolId);
  return Object.values(state.lootChests.snapshots)
    .filter((snapshot) => snapshot.poolId === id)
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
}

export function listLootChestLocations(): LootChestLocation[] {
  return Object.values(state.lootChests.chests).sort((a, b) => a.dimensionId.localeCompare(b.dimensionId) || a.x - b.x || a.y - b.y || a.z - b.z);
}

export function getLootChestPool(poolId: string): LootChestPool | undefined {
  return state.lootChests.pools[normalizeId(poolId)];
}

export function getLootChestLocation(location: LocationInput): LootChestLocation | undefined {
  return state.lootChests.chests[locationKey(location)];
}

export function createLootChestPool(name: string): RefillResult & { pool?: LootChestPool } {
  const id = normalizeId(name);
  if (!id) return { ok: false, message: "Pool name is required." };
  if (state.lootChests.pools[id]) return { ok: false, message: `Pool already exists: ${id}` };
  const pool: LootChestPool = { id, name: name.trim(), enabled: true, snapshotIds: [] };
  state.lootChests.pools[id] = pool;
  saveLootChests();
  invalidateLootChestRuntimeCache();
  return { ok: true, message: `Created loot pool ${pool.name}.`, pool };
}

export function updateLootChestPool(poolId: string, patch: Partial<Pick<LootChestPool, "name" | "enabled">>): RefillResult {
  const pool = getLootChestPool(poolId);
  if (!pool) return { ok: false, message: "Pool not found." };
  if (patch.name !== undefined) pool.name = patch.name.trim() || pool.name;
  if (patch.enabled !== undefined) pool.enabled = patch.enabled;
  saveLootChests();
  invalidateLootChestRuntimeCache();
  return { ok: true, message: `Updated loot pool ${pool.name}.` };
}

export function deleteLootChestPool(poolId: string): RefillResult {
  const id = normalizeId(poolId);
  const pool = state.lootChests.pools[id];
  if (!pool) return { ok: false, message: "Pool not found." };
  for (const snapshotId of pool.snapshotIds) delete state.lootChests.snapshots[snapshotKey(id, snapshotId)];
  for (const chest of Object.values(state.lootChests.chests)) {
    if (chest.poolId === id) delete state.lootChests.chests[chest.id];
  }
  delete state.lootChests.pools[id];
  saveLootChests();
  invalidateLootChestRuntimeCache();
  return { ok: true, message: `Deleted loot pool ${pool.name}.` };
}

export function captureLootChestSnapshot(poolId: string, source: LocationInput, name: string, weight: number): RefillResult & { snapshot?: LootChestSnapshot } {
  const pool = getLootChestPool(poolId);
  if (!pool) return { ok: false, message: "Pool not found." };
  const container = getContainerAt(source);
  if (!container) return { ok: false, message: "Target block is not a chest/container." };
  const items = serializeContainer(container);
  if (items.length === 0) return { ok: false, message: "Cannot capture an empty chest." };
  const baseId = normalizeId(name) || `snapshot_${pool.snapshotIds.length + 1}`;
  let id = baseId;
  let suffix = 2;
  while (state.lootChests.snapshots[snapshotKey(pool.id, id)]) id = `${baseId}_${suffix++}`;
  const snapshot: LootChestSnapshot = {
    id,
    poolId: pool.id,
    name: name.trim() || id,
    weight: Math.max(1, Math.floor(weight || 1)),
    enabled: true,
    containerSize: container.size,
    capturedAt: nowMs(),
    source: { dimensionId: source.dimensionId, x: Math.floor(source.x), y: Math.floor(source.y), z: Math.floor(source.z) },
    items,
  };
  state.lootChests.snapshots[snapshotKey(pool.id, id)] = snapshot;
  if (!pool.snapshotIds.includes(id)) pool.snapshotIds.push(id);
  if (!saveLootChests()) return { ok: false, message: "Snapshot was too large to save. Remove some complex items and retry." };
  invalidateLootChestRuntimeCache();
  return { ok: true, message: `Captured ${items.length} item stack(s) as ${snapshot.name}.`, snapshot };
}

export function updateLootChestSnapshot(poolId: string, snapshotId: string, patch: Partial<Pick<LootChestSnapshot, "name" | "weight" | "enabled">>): RefillResult {
  const snapshot = state.lootChests.snapshots[snapshotKey(normalizeId(poolId), normalizeId(snapshotId))];
  if (!snapshot) return { ok: false, message: "Snapshot not found." };
  if (patch.name !== undefined) snapshot.name = patch.name.trim() || snapshot.name;
  if (patch.weight !== undefined) snapshot.weight = Math.max(1, Math.floor(Number(patch.weight) || 1));
  if (patch.enabled !== undefined) snapshot.enabled = patch.enabled;
  saveLootChests();
  invalidateLootChestRuntimeCache();
  return { ok: true, message: `Updated snapshot ${snapshot.name}.` };
}

export function deleteLootChestSnapshot(poolId: string, snapshotId: string): RefillResult {
  const normalizedPoolId = normalizeId(poolId);
  const normalizedSnapshotId = normalizeId(snapshotId);
  const key = snapshotKey(normalizedPoolId, normalizedSnapshotId);
  const snapshot = state.lootChests.snapshots[key];
  if (!snapshot) return { ok: false, message: "Snapshot not found." };
  delete state.lootChests.snapshots[key];
  const pool = state.lootChests.pools[normalizedPoolId];
  if (pool) pool.snapshotIds = pool.snapshotIds.filter((id) => id !== normalizedSnapshotId);
  saveLootChests();
  invalidateLootChestRuntimeCache();
  return { ok: true, message: `Deleted snapshot ${snapshot.name}.` };
}

export function bindLootChestLocation(location: LocationInput, poolId: string, options: { respawnTicks?: number; refillMode?: LootChestRefillMode; preserveSlots?: boolean } = {}): RefillResult {
  const pool = getLootChestPool(poolId);
  if (!pool) return { ok: false, message: "Pool not found." };
  if (!getContainerAt(location)) return { ok: false, message: "Target block is not a chest/container." };
  const key = locationKey(location);
  state.lootChests.chests[key] = {
    id: key,
    poolId: pool.id,
    dimensionId: location.dimensionId,
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
    enabled: true,
    respawnTicks: Math.max(1, Math.floor(options.respawnTicks ?? state.lootChests.config.defaultRespawnTicks)),
    nextRefillAt: nowMs(),
    refillMode: options.refillMode ?? "empty_only",
    preserveSlots: options.preserveSlots ?? true,
    refillMessageEnabled: false,
    refillMessage: "§aLoot chest refilled at [x] [y] [z].",
    broadcastRefillMessage: false,
    refillCommandsEnabled: false,
    refillCommands: [],
  };
  saveLootChests();
  invalidateLootChestRuntimeCache();
  return { ok: true, message: `Bound loot chest at ${key} to ${pool.name}.` };
}

export function updateLootChestLocation(chestId: string, patch: Partial<Pick<LootChestLocation, "poolId" | "enabled" | "respawnTicks" | "refillMode" | "preserveSlots" | "refillMessageEnabled" | "refillMessage" | "broadcastRefillMessage" | "refillCommandsEnabled" | "refillCommands">>): RefillResult {
  const chest = state.lootChests.chests[chestId];
  if (!chest) return { ok: false, message: "Loot chest not found." };
  if (patch.poolId !== undefined) {
    const pool = getLootChestPool(patch.poolId);
    if (!pool) return { ok: false, message: "Pool not found." };
    chest.poolId = pool.id;
  }
  if (patch.enabled !== undefined) chest.enabled = patch.enabled;
  if (patch.respawnTicks !== undefined) chest.respawnTicks = Math.max(1, Math.floor(Number(patch.respawnTicks) || chest.respawnTicks));
  if (patch.refillMode !== undefined) chest.refillMode = patch.refillMode;
  if (patch.preserveSlots !== undefined) chest.preserveSlots = patch.preserveSlots;
  if (patch.refillMessageEnabled !== undefined) chest.refillMessageEnabled = patch.refillMessageEnabled;
  if (patch.refillMessage !== undefined) chest.refillMessage = patch.refillMessage;
  if (patch.broadcastRefillMessage !== undefined) chest.broadcastRefillMessage = patch.broadcastRefillMessage;
  if (patch.refillCommandsEnabled !== undefined) chest.refillCommandsEnabled = patch.refillCommandsEnabled;
  if (patch.refillCommands !== undefined) chest.refillCommands = patch.refillCommands.slice(0, 10);
  saveLootChests();
  invalidateLootChestRuntimeCache();
  return { ok: true, message: `Updated loot chest ${chest.id}.` };
}

export function deleteLootChestLocation(chestId: string): RefillResult {
  const chest = state.lootChests.chests[chestId];
  if (!chest) return { ok: false, message: "Loot chest not found." };
  delete state.lootChests.chests[chestId];
  saveLootChests();
  invalidateLootChestRuntimeCache();
  return { ok: true, message: `Deleted loot chest ${chestId}.` };
}

export function refillLootChest(chest: LootChestLocation, force = false): RefillResult {
  const pool = state.lootChests.pools[chest.poolId];
  if (!pool?.enabled && !force) return { ok: false, message: "Pool is disabled." };
  const snapshots = getRuntimeCache().snapshotsByPoolId.get(chest.poolId) ?? [];
  const snapshot = chooseWeightedSnapshot(snapshots);
  if (!snapshot) return { ok: false, message: "Pool has no enabled weighted snapshots." };
  const container = getContainerAt(chest);
  if (!container) return { ok: false, message: "Target loot chest is missing or not a container." };
  if (!force && chest.refillMode === "empty_only" && !isContainerEmpty(container)) {
    chest.nextRefillAt = nowMs() + Math.max(1, state.lootChests.config.processIntervalTicks) * 50;
    return { ok: true, message: "Chest is not empty; retrying soon.", savedChange: false };
  }
  const placed = restoreSnapshotToContainer(snapshot, container, chest.preserveSlots);
  chest.nextRefillAt = nowMs() + Math.max(1, chest.respawnTicks) * 50;
  if (placed > 0) runRefillSideEffects(chest, snapshot, placed);
  return { ok: placed > 0, message: placed > 0 ? `Refilled with ${snapshot.name}.` : `No items from ${snapshot.name} could be placed.`, savedChange: true };
}

export function forceRefillLootChest(chestId: string): RefillResult {
  const chest = state.lootChests.chests[chestId];
  if (!chest) return { ok: false, message: "Loot chest not found." };
  const result = refillLootChest(chest, true);
  saveLootChests();
  invalidateLootChestRuntimeCache();
  return result;
}

export function processLootChests(): void {
  if (!isFeatureEnabled("lootChests")) return;
  if (!state.lootChests.config.enabled) return;
  const cache = getRuntimeCache();
  if (cache.enabledChests.length === 0) {
    processCursor = 0;
    return;
  }
  const now = nowMs();
  if (now < cache.earliestDueAt) return;
  const budget = Math.max(1, Math.floor(state.lootChests.config.maxRefillsPerTick || 1));
  let changed = false;
  let cacheChanged = false;
  for (let count = 0; count < Math.min(budget, cache.enabledChests.length); count++) {
    const chest = cache.enabledChests[processCursor % cache.enabledChests.length];
    processCursor = (processCursor + 1) % cache.enabledChests.length;
    if (!chest || now < chest.nextRefillAt) continue;
    const result = refillLootChest(chest);
    cacheChanged = true;
    if (result.savedChange !== false) changed = true;
  }
  if (changed) {
    saveLootChests();
    invalidateLootChestRuntimeCache();
  } else if (cacheChanged) {
    invalidateLootChestRuntimeCache();
  }
}

export function registerLootChestSystem(): void {
  system.runInterval(() => {
    processLootChests();
  }, Math.max(1, state.lootChests.config.processIntervalTicks));
}

export function getLookedAtContainerLocation(player: Player, maxDistance = 8): LocationInput | undefined {
  const target = player.getBlockFromViewDirection({ maxDistance });
  const block = target?.block;
  if (!block) return undefined;
  return { dimensionId: block.dimension.id, x: block.location.x, y: block.location.y, z: block.location.z };
}

export function playerBlockLocation(player: Player): LocationInput {
  return {
    dimensionId: player.dimension.id,
    x: Math.floor(player.location.x),
    y: Math.floor(player.location.y),
    z: Math.floor(player.location.z),
  };
}

export function shouldCancelLootChestBreak(player: Player, location: Vector3, dimensionId: string): boolean {
  if (!state.lootChests.config.enabled) return false;
  if (isOperator(player)) return false;
  return Boolean(state.lootChests.chests[locationKey({ dimensionId, x: location.x, y: location.y, z: location.z })]);
}

export function describeLootChest(chest: LootChestLocation): string {
  const pool = state.lootChests.pools[chest.poolId];
  return `${chest.dimensionId} ${chest.x} ${chest.y} ${chest.z} -> ${pool?.name ?? chest.poolId}`;
}

export function sendLootChestResult(player: Player, result: RefillResult): void {
  tell(player, result.ok ? `§a${result.message}` : `§c${result.message}`);
}
