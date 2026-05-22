import { world } from "@minecraft/server";
import { safeSetDynamicJson, CUSTOM_AREAS_CONFIG_KEY, CUSTOM_AREAS_AREA_PREFIX, parseJSON } from "../dynamic-json";
import { type CustomAreaDefinition, type CustomAreaStore } from "../../types";
import { defaultCustomAreaStore } from "../defaults";

export function loadCustomAreasFromSplitKeys(dynamicPropertyIds: string[]): { store: CustomAreaStore; hasSplitData: boolean } {
  const base = defaultCustomAreaStore();
  let hasSplitData = false;
  const configRaw = world.getDynamicProperty(CUSTOM_AREAS_CONFIG_KEY) as string | undefined;
  if (configRaw) {
    base.config = { ...base.config, ...parseJSON<Partial<CustomAreaStore["config"]>>(configRaw, {}) };
    hasSplitData = true;
  }
  for (const key of dynamicPropertyIds) {
    if (!key.startsWith(CUSTOM_AREAS_AREA_PREFIX)) continue;
    const raw = world.getDynamicProperty(key) as string | undefined;
    const parsed = parseJSON<CustomAreaDefinition | undefined>(raw, undefined);
    if (!parsed?.id) continue;
    base.areas[parsed.id] = parsed;
    hasSplitData = true;
  }
  return { store: base, hasSplitData };
}

export function writeCustomAreasToSplitKeys(store: CustomAreaStore): boolean {
  let ok = safeSetDynamicJson(CUSTOM_AREAS_CONFIG_KEY, store.config);
  const wantedKeys = new Set<string>([CUSTOM_AREAS_CONFIG_KEY]);
  for (const [areaId, area] of Object.entries(store.areas)) {
    const key = `${CUSTOM_AREAS_AREA_PREFIX}${areaId}`;
    wantedKeys.add(key);
    ok = safeSetDynamicJson(key, area) && ok;
  }
  for (const key of world.getDynamicPropertyIds()) {
    if (key.startsWith(CUSTOM_AREAS_AREA_PREFIX) && !wantedKeys.has(key)) world.setDynamicProperty(key, undefined);
  }
  return ok;
}
