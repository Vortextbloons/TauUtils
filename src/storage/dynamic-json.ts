import { system, world } from "@minecraft/server";
import { STORAGE_KEYS } from "../types";
import { estimateUtf8Bytes } from "../shared/utf8";
import { safeCall } from "../shared/safe-call";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLAYER_SHOPS_CONFIG_KEY = `${STORAGE_KEYS.playerShops}:config`;
export const PLAYER_SHOPS_SHOP_PREFIX = `${STORAGE_KEYS.playerShops}:shop:`;
export const PLAYER_SHOPS_LISTING_PREFIX = `${STORAGE_KEYS.playerShops}:listing:`;
export const PLAYER_SHOPS_EARNINGS_PREFIX = `${STORAGE_KEYS.playerShops}:earn:`;
export const CUSTOM_AREAS_CONFIG_KEY = `${STORAGE_KEYS.customAreas}:config`;
export const CUSTOM_AREAS_AREA_PREFIX = `${STORAGE_KEYS.customAreas}:area:`;
export const LOOT_CHESTS_CONFIG_KEY = `${STORAGE_KEYS.lootChests}:config`;
export const LOOT_CHESTS_POOL_PREFIX = `${STORAGE_KEYS.lootChests}:pool:`;
export const LOOT_CHESTS_SNAPSHOT_PREFIX = `${STORAGE_KEYS.lootChests}:snapshot:`;
export const LOOT_CHESTS_CHEST_PREFIX = `${STORAGE_KEYS.lootChests}:chest:`;

export const PLOTS_CONFIG_KEY = `${STORAGE_KEYS.plots}:config`;
export const PLOTS_SLOT_PREFIX = `${STORAGE_KEYS.plots}:slot:`;
export const PLOTS_PLAYER_SLOT_PREFIX = `${STORAGE_KEYS.plots}:player:`;
export const PLOTS_SNAPSHOT_PREFIX = `${STORAGE_KEYS.plots}:snapshot:`;
export const PLOTS_MIGRATION_MARKER_KEY = `${STORAGE_KEYS.plots}:migration_v2_done`;

const MAX_DYNAMIC_STRING_BYTES = 32000;
const SPLIT_DYNAMIC_JSON_CHUNK_BYTES = 30000;
export const STATS_PLAYER_IDS_KEY = "tau:stats:player_ids";
export const STATS_PLAYER_PREFIX = "tau:stats:player:";

// ---------------------------------------------------------------------------
// Split-key helpers
// ---------------------------------------------------------------------------

function dynamicJsonChunkCountKey(key: string): string {
  return `${key}:chunks`;
}

function dynamicJsonChunkPrefix(key: string): string {
  return `${key}:chunk:`;
}

function splitUtf8String(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    let char = value[i];
    let charBytes = 1;
    if (code <= 0x7f) charBytes = 1;
    else if (code <= 0x7ff) charBytes = 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      char += value[i + 1];
      charBytes = 4;
      i++;
    } else charBytes = 3;

    if (currentBytes > 0 && currentBytes + charBytes > maxBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }

  chunks.push(current);
  return chunks;
}

export function readSplitDynamicJson<T>(key: string, fallback: T): { value: T; hasSplitData: boolean } {
  const chunkCountRaw = world.getDynamicProperty(dynamicJsonChunkCountKey(key));
  const chunkCount = typeof chunkCountRaw === "number" ? chunkCountRaw : Number(chunkCountRaw ?? 0);
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) return { value: fallback, hasSplitData: false };

  let raw = "";
  for (let index = 0; index < chunkCount; index++) {
    const chunk = world.getDynamicProperty(`${dynamicJsonChunkPrefix(key)}${index}`);
    if (typeof chunk !== "string") return { value: fallback, hasSplitData: false };
    raw += chunk;
  }

  return { value: parseJSON<T>(raw, fallback), hasSplitData: true };
}

export function clearSplitDynamicJson(key: string, dynamicPropertyIds: string[] = world.getDynamicPropertyIds()): void {
  const prefix = dynamicJsonChunkPrefix(key);
  world.setDynamicProperty(dynamicJsonChunkCountKey(key), undefined);
  for (const propertyKey of dynamicPropertyIds) {
    if (propertyKey.startsWith(prefix)) world.setDynamicProperty(propertyKey, undefined);
  }
}

export function writeSplitDynamicJson(key: string, value: unknown): boolean {
  const serialized = JSON.stringify(value);
  const chunks = splitUtf8String(serialized, SPLIT_DYNAMIC_JSON_CHUNK_BYTES);
  const chunkPrefix = dynamicJsonChunkPrefix(key);
  const wantedKeys = new Set<string>();

  for (let index = 0; index < chunks.length; index++) {
    const chunkKey = `${chunkPrefix}${index}`;
    wantedKeys.add(chunkKey);
    world.setDynamicProperty(chunkKey, chunks[index]);
  }
  world.setDynamicProperty(dynamicJsonChunkCountKey(key), chunks.length);

  for (const propertyKey of world.getDynamicPropertyIds()) {
    if (propertyKey.startsWith(chunkPrefix) && !wantedKeys.has(propertyKey)) {
      world.setDynamicProperty(propertyKey, undefined);
    }
  }

  return true;
}

export function safeSetDynamicJson(key: string, value: unknown): boolean {
  const serialized = JSON.stringify(value);
  if (estimateUtf8Bytes(serialized) > MAX_DYNAMIC_STRING_BYTES) {
    console.warn(
      `[TauUtils] DynamicProperty overflow blocked for key ${key}. Size exceeds ${MAX_DYNAMIC_STRING_BYTES} bytes.`
    );
    return false;
  }
  world.setDynamicProperty(key, serialized);
  return true;
}

export function serializeDynamicJson(key: string, value: unknown): string | undefined {
  const serialized = JSON.stringify(value);
  if (estimateUtf8Bytes(serialized) > MAX_DYNAMIC_STRING_BYTES) {
    console.warn(
      `[TauUtils] DynamicProperty overflow blocked for key ${key}. Size exceeds ${MAX_DYNAMIC_STRING_BYTES} bytes.`
    );
    return undefined;
  }
  return serialized;
}

export function setDynamicJsonIfChanged(key: string, value: unknown, persisted: Map<string, string>): boolean {
  const serialized = serializeDynamicJson(key, value);
  if (serialized === undefined) return false;
  if (persisted.get(key) === serialized) return true;
  world.setDynamicProperty(key, serialized);
  persisted.set(key, serialized);
  return true;
}

export function clearPersistedDynamicKey(key: string, persisted: Map<string, string>): void {
  world.setDynamicProperty(key, undefined);
  persisted.delete(key);
}

// ---------------------------------------------------------------------------
// JSON parsing utility
// ---------------------------------------------------------------------------

export function parseJSON<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readDynamicJSON<T>(key: string, fallback: T): T {
  return safeCall(() => parseJSON<T>(world.getDynamicProperty(key) as string | undefined, fallback), fallback);
}
