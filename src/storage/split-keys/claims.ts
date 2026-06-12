import { world } from "@minecraft/server";
import { type ClaimStore } from "../../types";
import { defaultClaimStore } from "../defaults";
import { CLAIMS_CLAIM_PREFIX, CLAIMS_CONFIG_KEY, parseJSON, setDynamicJsonIfChanged } from "../dynamic-json";

let persistedClaimKeys = new Set<string>();
const persisted = new Map<string, string>();

export function loadClaimsFromSplitKeys(dynamicPropertyIds: string[]): { store: ClaimStore; hasSplitData: boolean } {
  const defaults = defaultClaimStore();
  const configRaw = world.getDynamicProperty(CLAIMS_CONFIG_KEY) as string | undefined;
  const claimKeys = dynamicPropertyIds.filter((key) => key.startsWith(CLAIMS_CLAIM_PREFIX));
  if (!configRaw && claimKeys.length === 0) return { store: defaults, hasSplitData: false };

  const store: ClaimStore = {
    ...defaults,
    config: parseJSON(configRaw, defaults.config),
    claims: {},
    playerClaimIds: {},
    teamClaimIds: {},
  };

  persisted.clear();
  if (configRaw) persisted.set(CLAIMS_CONFIG_KEY, configRaw);
  persistedClaimKeys = new Set(claimKeys);

  for (const key of claimKeys) {
    const raw = world.getDynamicProperty(key) as string | undefined;
    if (!raw) continue;
    const claim = parseJSON(raw, undefined as unknown as ClaimStore["claims"][string] | undefined);
    if (!claim?.id) continue;
    store.claims[claim.id] = claim;
    persisted.set(key, raw);
    store.playerClaimIds[claim.ownerPlayerId] ??= [];
    store.playerClaimIds[claim.ownerPlayerId].push(claim.id);
    if (claim.teamId) {
      store.teamClaimIds[claim.teamId] ??= [];
      store.teamClaimIds[claim.teamId].push(claim.id);
    }
  }

  return { store, hasSplitData: true };
}

export function writeClaimsToSplitKeys(store: ClaimStore): boolean {
  const nextKeys = new Set<string>();
  setDynamicJsonIfChanged(CLAIMS_CONFIG_KEY, store.config, persisted);
  for (const claim of Object.values(store.claims)) {
    const key = `${CLAIMS_CLAIM_PREFIX}${claim.id}`;
    nextKeys.add(key);
    if (!setDynamicJsonIfChanged(key, claim, persisted)) return false;
  }
  for (const oldKey of persistedClaimKeys) {
    if (!nextKeys.has(oldKey)) {
      world.setDynamicProperty(oldKey, undefined);
      persisted.delete(oldKey);
    }
  }
  persistedClaimKeys = nextKeys;
  return true;
}
