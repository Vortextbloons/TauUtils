import { world } from "@minecraft/server";
import { parseJSON, safeSetDynamicJson } from "./dynamic-json";

const STORAGE_META_KEY = "tau:meta";
const CURRENT_STORAGE_VERSION = 1;

type StorageMeta = {
  version: number;
};

function readStorageMeta(): StorageMeta {
  const raw = world.getDynamicProperty(STORAGE_META_KEY) as string | undefined;
  const parsed = parseJSON<Partial<StorageMeta> | undefined>(raw, undefined);
  return { version: Math.max(0, Math.floor(Number(parsed?.version ?? 0))) };
}

export function runStorageMigrations(): void {
  const meta = readStorageMeta();
  if (meta.version >= CURRENT_STORAGE_VERSION) return;

  safeSetDynamicJson(STORAGE_META_KEY, { version: CURRENT_STORAGE_VERSION });
}

export { STORAGE_META_KEY, CURRENT_STORAGE_VERSION };
