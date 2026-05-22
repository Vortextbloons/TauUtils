import { world } from "@minecraft/server";
import { serializeDynamicJson, setDynamicJsonIfChanged, clearPersistedDynamicKey, safeSetDynamicJson, PLAYER_SHOPS_CONFIG_KEY, PLAYER_SHOPS_SHOP_PREFIX, PLAYER_SHOPS_LISTING_PREFIX, PLAYER_SHOPS_EARNINGS_PREFIX, parseJSON } from "../dynamic-json";
import { type PlayerShop, type PlayerShopListing, type PlayerShopStore } from "../../types";
import { defaultPlayerShopStore } from "../defaults";
import { state } from "../state";

const persistedPlayerShopJsonByKey = new Map<string, string>();

export function loadPlayerShopsFromSplitKeys(dynamicPropertyIds: string[]): { store: PlayerShopStore; hasSplitData: boolean } {
  const base = defaultPlayerShopStore();
  let hasSplitData = false;

  const configRaw = world.getDynamicProperty(PLAYER_SHOPS_CONFIG_KEY) as string | undefined;
  if (configRaw) {
    hasSplitData = true;
    const parsed = parseJSON<Partial<PlayerShopStore["config"]>>(configRaw, {});
    base.config = { ...base.config, ...parsed };
  }

  for (const key of dynamicPropertyIds) {
    if (key.startsWith(PLAYER_SHOPS_SHOP_PREFIX)) {
      const raw = world.getDynamicProperty(key) as string | undefined;
      const parsed = parseJSON<PlayerShop | undefined>(raw, undefined);
      if (!parsed || !parsed.id) continue;
      base.shops[parsed.id] = parsed;
      hasSplitData = true;
      continue;
    }
    if (key.startsWith(PLAYER_SHOPS_LISTING_PREFIX)) {
      const raw = world.getDynamicProperty(key) as string | undefined;
      const parsed = parseJSON<PlayerShopListing | undefined>(raw, undefined);
      if (!parsed || !parsed.id) continue;
      base.listings[parsed.id] = parsed;
      hasSplitData = true;
      continue;
    }
    if (key.startsWith(PLAYER_SHOPS_EARNINGS_PREFIX)) {
      const playerId = key.slice(PLAYER_SHOPS_EARNINGS_PREFIX.length);
      if (!playerId) continue;
      const raw = world.getDynamicProperty(key) as string | undefined;
      const parsed = parseJSON<Record<string, number> | undefined>(raw, undefined);
      if (!parsed) continue;
      base.earningsByPlayerId[playerId] = parsed;
      hasSplitData = true;
      continue;
    }
  }

  return { store: base, hasSplitData };
}

export function writePlayerShopsIncrementalToSplitKeys(store: PlayerShopStore): boolean {
  let ok = true;
  const wantedKeys = new Set<string>();

  wantedKeys.add(PLAYER_SHOPS_CONFIG_KEY);
  ok = setDynamicJsonIfChanged(PLAYER_SHOPS_CONFIG_KEY, store.config, persistedPlayerShopJsonByKey) && ok;

  for (const [shopId, shop] of Object.entries(store.shops)) {
    const key = `${PLAYER_SHOPS_SHOP_PREFIX}${shopId}`;
    wantedKeys.add(key);
    ok = setDynamicJsonIfChanged(key, shop, persistedPlayerShopJsonByKey) && ok;
  }
  for (const [listingId, listing] of Object.entries(store.listings)) {
    const key = `${PLAYER_SHOPS_LISTING_PREFIX}${listingId}`;
    wantedKeys.add(key);
    ok = setDynamicJsonIfChanged(key, listing, persistedPlayerShopJsonByKey) && ok;
  }
  for (const [playerId, earnings] of Object.entries(store.earningsByPlayerId)) {
    const key = `${PLAYER_SHOPS_EARNINGS_PREFIX}${playerId}`;
    wantedKeys.add(key);
    ok = setDynamicJsonIfChanged(key, earnings, persistedPlayerShopJsonByKey) && ok;
  }

  for (const key of [...persistedPlayerShopJsonByKey.keys()]) {
    if (!wantedKeys.has(key)) clearPersistedDynamicKey(key, persistedPlayerShopJsonByKey);
  }

  return ok;
}

export function rememberPlayerShopSplitKeys(store: PlayerShopStore): void {
  persistedPlayerShopJsonByKey.clear();
  const config = serializeDynamicJson(PLAYER_SHOPS_CONFIG_KEY, store.config);
  if (config !== undefined) persistedPlayerShopJsonByKey.set(PLAYER_SHOPS_CONFIG_KEY, config);
  for (const [shopId, shop] of Object.entries(store.shops)) {
    const key = `${PLAYER_SHOPS_SHOP_PREFIX}${shopId}`;
    const serialized = serializeDynamicJson(key, shop);
    if (serialized !== undefined) persistedPlayerShopJsonByKey.set(key, serialized);
  }
  for (const [listingId, listing] of Object.entries(store.listings)) {
    const key = `${PLAYER_SHOPS_LISTING_PREFIX}${listingId}`;
    const serialized = serializeDynamicJson(key, listing);
    if (serialized !== undefined) persistedPlayerShopJsonByKey.set(key, serialized);
  }
  for (const [playerId, earnings] of Object.entries(store.earningsByPlayerId)) {
    const key = `${PLAYER_SHOPS_EARNINGS_PREFIX}${playerId}`;
    const serialized = serializeDynamicJson(key, earnings);
    if (serialized !== undefined) persistedPlayerShopJsonByKey.set(key, serialized);
  }
}
