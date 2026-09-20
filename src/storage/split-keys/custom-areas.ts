import { world } from "@minecraft/server";
import { serializeDynamicJson, setDynamicJsonIfChanged, clearPersistedDynamicKey, CUSTOM_AREAS_CONFIG_KEY, CUSTOM_AREAS_AREA_PREFIX, parseJSON } from "../dynamic-json";
import { type CustomAreaDefinition, type CustomAreaStore } from "../../types";
import { defaultCustomAreaStore } from "../defaults";

const persistedCustomAreaJsonByKey = new Map<string, string>();

export function loadCustomAreasFromSplitKeys(dynamicPropertyIds: string[]): { store: CustomAreaStore; hasSplitData: boolean } {
  const base = defaultCustomAreaStore();
  let hasSplitData = false;
  persistedCustomAreaJsonByKey.clear();
  const configRaw = world.getDynamicProperty(CUSTOM_AREAS_CONFIG_KEY) as string | undefined;
  if (configRaw) {
    base.config = { ...base.config, ...parseJSON<Partial<CustomAreaStore["config"]>>(configRaw, {}) };
    persistedCustomAreaJsonByKey.set(CUSTOM_AREAS_CONFIG_KEY, configRaw);
    hasSplitData = true;
  }
  for (const key of dynamicPropertyIds) {
    if (!key.startsWith(CUSTOM_AREAS_AREA_PREFIX)) continue;
    const raw = world.getDynamicProperty(key) as string | undefined;
    const parsed = parseJSON<CustomAreaDefinition | undefined>(raw, undefined);
    if (!parsed?.id) continue;
    base.areas[parsed.id] = parsed;
    if (raw) persistedCustomAreaJsonByKey.set(key, raw);
    hasSplitData = true;
  }
  return { store: base, hasSplitData };
}

export function rememberCustomAreaSplitKeys(store: CustomAreaStore): void {
  persistedCustomAreaJsonByKey.clear();
  const config = serializeDynamicJson(CUSTOM_AREAS_CONFIG_KEY, store.config);
  if (config !== undefined) persistedCustomAreaJsonByKey.set(CUSTOM_AREAS_CONFIG_KEY, config);
  for (const [areaId, area] of Object.entries(store.areas)) {
    const key = `${CUSTOM_AREAS_AREA_PREFIX}${areaId}`;
    const serialized = serializeDynamicJson(key, area);
    if (serialized !== undefined) persistedCustomAreaJsonByKey.set(key, serialized);
  }
}

export function writeCustomAreasToSplitKeys(store: CustomAreaStore): boolean {
  let ok = true;
  const wantedKeys = new Set<string>();

  wantedKeys.add(CUSTOM_AREAS_CONFIG_KEY);
  ok = setDynamicJsonIfChanged(CUSTOM_AREAS_CONFIG_KEY, store.config, persistedCustomAreaJsonByKey) && ok;

  for (const [areaId, area] of Object.entries(store.areas)) {
    const key = `${CUSTOM_AREAS_AREA_PREFIX}${areaId}`;
    wantedKeys.add(key);
    ok = setDynamicJsonIfChanged(key, area, persistedCustomAreaJsonByKey) && ok;
  }

  // GC only over keys we previously persisted; no world.getDynamicPropertyIds() scan.
  for (const key of [...persistedCustomAreaJsonByKey.keys()]) {
    if (!wantedKeys.has(key)) clearPersistedDynamicKey(key, persistedCustomAreaJsonByKey);
  }

  return ok;
}
