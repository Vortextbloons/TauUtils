import type {
  ClaimStore,
  CrateStore,
  CustomAreaStore,
  FormDefinition,
  GeneratorStore,
  HomeStore,
  LootChestStore,
  PlayerShopStore,
  ShopProfile,
  TauItemsStore,
  TeamStore,
} from "../types";
import { parseFinite, parseFloatIn, parseIntIn } from "../shared/numbers";

// ---------------------------------------------------------------------------
// Per-store schema validate + repair helpers.
// Each validator mutates the passed-in store slice in place, counts the
// fields/entries it repaired or dropped, and reports { ok, fixed }.
// ok=false only when the slice itself is not a usable object.
// ---------------------------------------------------------------------------

export type StoreValidationResult = {
  ok: boolean;
  fixed: number;
};

export type AllStoreSlices = {
  forms: Record<string, FormDefinition>;
  shops: Record<string, ShopProfile>;
  teams: TeamStore;
  homes: HomeStore;
  generators: GeneratorStore;
  crates: CrateStore;
  tauItems: TauItemsStore;
  playerShops: PlayerShopStore;
  claims: ClaimStore;
  customAreas: CustomAreaStore;
  lootChests: LootChestStore;
};

export type StoreValidationSummary = {
  ok: boolean;
  fixed: number;
  perStore: Record<string, number>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim().length > 0) out.push(entry);
  }
  return out;
}

function isFiniteVector(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Number.isFinite(value["x"]) && Number.isFinite(value["y"]) && Number.isFinite(value["z"]);
}

export function validateForms(forms: Record<string, FormDefinition>): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(forms)) return { ok: false, fixed: 0 };
  for (const [key, form] of Object.entries(forms)) {
    if (!isRecord(form) || typeof form["id"] !== "string" || form["id"].trim().length === 0) {
      delete forms[key];
      fixed++;
      continue;
    }
    const def = form as unknown as FormDefinition;
    if (typeof def.title !== "string") {
      def.title = def.id;
      fixed++;
    }
    if (def.layout !== "action" && def.layout !== "modal") {
      def.layout = "action";
      fixed++;
    }
    if (!Array.isArray(def.elements)) {
      def.elements = [];
      fixed++;
      continue;
    }
    for (const element of def.elements) {
      if (!isRecord(element)) continue;
      const kind = element["kind"];
      if (kind === "slider") {
        const min = Number.isFinite(element["min"]) ? (element["min"] as number) : 0;
        const max = Number.isFinite(element["max"]) ? (element["max"] as number) : 100;
        if (element["min"] !== min) {
          element["min"] = min;
          fixed++;
        }
        if (element["max"] !== max) {
          element["max"] = max;
          fixed++;
        }
        const lo = Math.min(min, max);
        const hi = Math.max(min, max);
        const repairedDefault = parseFloatIn(element["defaultValue"], lo, hi, lo);
        if (element["defaultValue"] !== repairedDefault) {
          element["defaultValue"] = repairedDefault;
          fixed++;
        }
        const step = typeof element["step"] === "number" && Number.isFinite(element["step"]) && element["step"] > 0
          ? (element["step"] as number)
          : 1;
        if (element["step"] !== step) {
          element["step"] = step;
          fixed++;
        }
      } else if (kind === "dropdown") {
        const options = Array.isArray(element["options"]) ? element["options"] : [];
        if (element["options"] !== options) {
          element["options"] = options;
          fixed++;
        }
        const repairedIndex = parseIntIn(element["defaultValueIndex"], 0, Math.max(0, options.length - 1), 0);
        if (element["defaultValueIndex"] !== repairedIndex) {
          element["defaultValueIndex"] = repairedIndex;
          fixed++;
        }
      } else if (kind === "toggle") {
        if (typeof element["defaultValue"] !== "boolean" && element["defaultValue"] !== undefined) {
          element["defaultValue"] = false;
          fixed++;
        }
      }
    }
  }
  return { ok: true, fixed };
}

export function validateShops(shops: Record<string, ShopProfile>): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(shops)) return { ok: false, fixed: 0 };
  for (const [key, profile] of Object.entries(shops)) {
    if (!isRecord(profile) || typeof profile["id"] !== "string" || (profile["id"] as string).trim().length === 0) {
      delete shops[key];
      fixed++;
      continue;
    }
    const shop = profile as unknown as ShopProfile;
    if (typeof shop.currencyObjective !== "string" || shop.currencyObjective.trim().length === 0) {
      shop.currencyObjective = "money";
      fixed++;
    }
    if (!Array.isArray(shop.items)) {
      shop.items = [];
      fixed++;
      continue;
    }
    for (const item of shop.items) {
      if (!isRecord(item)) continue;
      const buy = Number.isFinite(item["buyPrice"]) && (item["buyPrice"] as number) >= 0
        ? (item["buyPrice"] as number)
        : 0;
      if (item["buyPrice"] !== buy) {
        item["buyPrice"] = buy;
        fixed++;
      }
      const sell = Number.isFinite(item["sellPrice"]) && (item["sellPrice"] as number) >= 0
        ? (item["sellPrice"] as number)
        : 0;
      if (item["sellPrice"] !== sell) {
        item["sellPrice"] = sell;
        fixed++;
      }
      const quantities = Array.isArray(item["quantities"])
        ? (item["quantities"] as unknown[]).filter(
            (q) => typeof q === "number" && Number.isFinite(q) && Math.floor(q) > 0
          ).map((q) => Math.floor(q as number))
        : [];
      if (quantities.length === 0) quantities.push(1);
      if (JSON.stringify(item["quantities"]) !== JSON.stringify(quantities)) {
        item["quantities"] = quantities;
        fixed++;
      }
      if (item["durability"] !== undefined && !Number.isFinite(item["durability"])) {
        delete item["durability"];
        fixed++;
      }
      if (item["maxDurability"] !== undefined && !Number.isFinite(item["maxDurability"])) {
        delete item["maxDurability"];
        fixed++;
      }
    }
  }
  return { ok: true, fixed };
}

export function validateTeams(teams: TeamStore): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(teams)) return { ok: false, fixed: 0 };
  const store = teams as TeamStore;
  const repairedMax = parseIntIn(store.maxMembers, 1, 1000, 10);
  if (store.maxMembers !== repairedMax) {
    store.maxMembers = repairedMax;
    fixed++;
  }
  if (!isRecord(store.teams)) {
    store.teams = {};
    fixed++;
  }
  for (const [teamId, team] of Object.entries(store.teams)) {
    if (!isRecord(team) || typeof team["id"] !== "string" || (team["id"] as string).trim().length === 0) {
      delete store.teams[teamId];
      fixed++;
      continue;
    }
    const def = team as unknown as TeamStore["teams"][string];
    const members = cleanStringArray(def.memberPlayerIds);
    if (JSON.stringify(def.memberPlayerIds) !== JSON.stringify(members)) {
      def.memberPlayerIds = [...new Set(members)];
      fixed++;
    } else if (def.memberPlayerIds.length !== new Set(def.memberPlayerIds).size) {
      def.memberPlayerIds = [...new Set(def.memberPlayerIds)];
      fixed++;
    }
    const invited = cleanStringArray(def.invitedPlayerIds);
    if (JSON.stringify(def.invitedPlayerIds) !== JSON.stringify(invited)) {
      def.invitedPlayerIds = [...new Set(invited)];
      fixed++;
    }
    if (typeof def.ownerPlayerId !== "string" || def.ownerPlayerId.trim().length === 0) {
      delete store.teams[teamId];
      fixed++;
      continue;
    }
    const createdAt = parseFinite(def.createdAt, 0);
    if (def.createdAt !== createdAt) {
      def.createdAt = createdAt;
      fixed++;
    }
  }
  if (!isRecord(store.playerTeamIds)) {
    store.playerTeamIds = {};
    fixed++;
  } else {
    for (const [playerId, teamId] of Object.entries(store.playerTeamIds)) {
      if (typeof teamId !== "string" || !store.teams[teamId]) {
        delete store.playerTeamIds[playerId];
        fixed++;
      }
    }
  }
  return { ok: true, fixed };
}

export function validateHomes(homes: HomeStore): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(homes)) return { ok: false, fixed: 0 };
  const store = homes as HomeStore;
  if (!isRecord(store.config)) return { ok: false, fixed };
  const repairedMax = parseIntIn(store.config.maxHomesDefault, 1, 1000, 2);
  if (store.config.maxHomesDefault !== repairedMax) {
    store.config.maxHomesDefault = repairedMax;
    fixed++;
  }
  if (!isRecord(store.homesByPlayerId)) {
    store.homesByPlayerId = {};
    fixed++;
    return { ok: true, fixed };
  }
  for (const [playerId, playerHomes] of Object.entries(store.homesByPlayerId)) {
    if (!isRecord(playerHomes)) {
      delete store.homesByPlayerId[playerId];
      fixed++;
      continue;
    }
    for (const [homeId, home] of Object.entries(playerHomes)) {
      if (!isFiniteVector(home)) {
        delete (store.homesByPlayerId[playerId] as Record<string, unknown>)[homeId];
        fixed++;
        continue;
      }
      const loc = home as unknown as HomeStore["homesByPlayerId"][string][string];
      if (typeof loc.dimensionId !== "string" || loc.dimensionId.trim().length === 0) {
        loc.dimensionId = "minecraft:overworld";
        fixed++;
      }
    }
    if (Object.keys(store.homesByPlayerId[playerId] ?? {}).length === 0) {
      delete store.homesByPlayerId[playerId];
    }
  }
  return { ok: true, fixed };
}

export function validateGenerators(generators: GeneratorStore): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(generators)) return { ok: false, fixed: 0 };
  const store = generators as GeneratorStore;
  if (!isRecord(store.definitions)) {
    store.definitions = {};
    fixed++;
  }
  for (const [defId, def] of Object.entries(store.definitions)) {
    if (!isRecord(def) || typeof def["id"] !== "string" || (def["id"] as string).trim().length === 0) {
      delete store.definitions[defId];
      fixed++;
      continue;
    }
    const definition = def as unknown as GeneratorStore["definitions"][string];
    if (definition.kind !== "fixed" && definition.kind !== "weighted") {
      definition.kind = "fixed";
      fixed++;
    }
    if (!Array.isArray(definition.tiers)) {
      definition.tiers = [];
      fixed++;
    } else {
      for (const tier of definition.tiers) {
        if (!isRecord(tier)) continue;
        const rate = parseIntIn(tier["rateTicks"], 0, 20 * 60 * 60 * 24, 20);
        if (tier["rateTicks"] !== rate) {
          tier["rateTicks"] = rate;
          fixed++;
        }
        const cost = parseFloatIn(tier["upgradeCost"], 0, Number.MAX_SAFE_INTEGER, 0);
        if (tier["upgradeCost"] !== cost) {
          tier["upgradeCost"] = cost;
          fixed++;
        }
      }
    }
    if (definition.autoBreakerCost !== undefined && !Number.isFinite(definition.autoBreakerCost)) {
      delete definition.autoBreakerCost;
      fixed++;
    }
  }
  if (!isRecord(store.placed)) {
    store.placed = {};
    fixed++;
  }
  for (const [placedId, placed] of Object.entries(store.placed)) {
    if (!isRecord(placed) || !Number.isFinite(placed["x"]) || !Number.isFinite(placed["y"]) || !Number.isFinite(placed["z"])) {
      delete store.placed[placedId];
      fixed++;
      continue;
    }
    const entry = placed as unknown as GeneratorStore["placed"][string];
    const tier = parseIntIn(entry.tier, 0, 1000000, 0);
    if (entry.tier !== tier) {
      entry.tier = tier;
      fixed++;
    }
    const nextSpawn = parseFinite(entry.nextSpawnAt, 0);
    if (entry.nextSpawnAt !== nextSpawn) {
      entry.nextSpawnAt = nextSpawn;
      fixed++;
    }
  }
  return { ok: true, fixed };
}

export function validateCrates(crates: CrateStore): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(crates)) return { ok: false, fixed: 0 };
  const store = crates as CrateStore;
  if (!isRecord(store.crates)) {
    store.crates = {};
    fixed++;
    return { ok: true, fixed };
  }
  for (const [crateId, crate] of Object.entries(store.crates)) {
    if (!isRecord(crate) || typeof crate["id"] !== "string" || (crate["id"] as string).trim().length === 0) {
      delete store.crates[crateId];
      fixed++;
      continue;
    }
    const def = crate as unknown as CrateStore["crates"][string];
    const threshold = parseFloatIn(def.rareBroadcastWeightThreshold, 0, Number.MAX_SAFE_INTEGER, 5);
    if (def.rareBroadcastWeightThreshold !== threshold) {
      def.rareBroadcastWeightThreshold = threshold;
      fixed++;
    }
    if (!Array.isArray(def.rewards)) {
      def.rewards = [];
      fixed++;
      continue;
    }
    for (const reward of def.rewards) {
      if (!isRecord(reward)) continue;
      const weight = Number.isFinite(reward["weight"]) && (reward["weight"] as number) > 0
        ? (reward["weight"] as number)
        : 1;
      if (reward["weight"] !== weight) {
        reward["weight"] = weight;
        fixed++;
      }
      if ("amount" in reward) {
        const amountRecord = reward as unknown as Record<string, unknown>;
        if (!Number.isFinite(amountRecord["amount"])) {
          amountRecord["amount"] = 1;
          fixed++;
        }
      }
    }
  }
  return { ok: true, fixed };
}

export function validateTauItems(tauItems: TauItemsStore): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(tauItems)) return { ok: false, fixed: 0 };
  const store = tauItems as TauItemsStore;
  if (!isRecord(store.items)) {
    store.items = {};
    fixed++;
    return { ok: true, fixed };
  }
  for (const [itemId, item] of Object.entries(store.items)) {
    if (!isRecord(item) || typeof item["id"] !== "string" || (item["id"] as string).trim().length === 0) {
      delete store.items[itemId];
      fixed++;
      continue;
    }
    const def = item as unknown as TauItemsStore["items"][string];
    const cooldown = parseFloatIn(def.cooldownSeconds, 0, 86400, 0);
    if (def.cooldownSeconds !== cooldown) {
      def.cooldownSeconds = cooldown;
      fixed++;
    }
    if (def.maxUses !== undefined && !(Number.isFinite(def.maxUses) && def.maxUses > 0)) {
      delete def.maxUses;
      fixed++;
    }
    if (def.cost !== undefined) {
      if (!isRecord(def.cost)) {
        delete def.cost;
        fixed++;
      } else {
        const amount = parseFloatIn(def.cost.amount, 0, Number.MAX_SAFE_INTEGER, 0);
        if (def.cost.amount !== amount) {
          def.cost.amount = amount;
          fixed++;
        }
      }
    }
    if (!Array.isArray(def.actions)) {
      def.actions = [];
      fixed++;
    }
  }
  return { ok: true, fixed };
}

export function validatePlayerShops(playerShops: PlayerShopStore): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(playerShops)) return { ok: false, fixed: 0 };
  const store = playerShops as PlayerShopStore;
  if (!isRecord(store.config)) return { ok: false, fixed };
  const minPrice = parseFloatIn(store.config.minPricePerUnit, 0, Number.MAX_SAFE_INTEGER, 1);
  if (store.config.minPricePerUnit !== minPrice) {
    store.config.minPricePerUnit = minPrice;
    fixed++;
  }
  const maxPrice = parseFloatIn(
    store.config.maxPricePerUnit,
    store.config.minPricePerUnit,
    Number.MAX_SAFE_INTEGER,
    1000000
  );
  if (store.config.maxPricePerUnit !== maxPrice) {
    store.config.maxPricePerUnit = maxPrice;
    fixed++;
  }
  const tax = parseFloatIn(store.config.taxPercent, 0, 100, 0);
  if (store.config.taxPercent !== tax) {
    store.config.taxPercent = tax;
    fixed++;
  }
  const maxListings = parseIntIn(store.config.maxListingsPerShop, 1, 10000, 32);
  if (store.config.maxListingsPerShop !== maxListings) {
    store.config.maxListingsPerShop = maxListings;
    fixed++;
  }
  if (!isRecord(store.shops)) {
    store.shops = {};
    fixed++;
  }
  for (const [shopId, shop] of Object.entries(store.shops)) {
    if (!isRecord(shop) || typeof shop["id"] !== "string" || (shop["id"] as string).trim().length === 0) {
      delete store.shops[shopId];
      fixed++;
      continue;
    }
    const entry = shop as unknown as PlayerShopStore["shops"][string];
    if (!Array.isArray(entry.listingIds)) {
      entry.listingIds = [];
      fixed++;
    }
    const created = parseFinite(entry.createdAt, 0);
    if (entry.createdAt !== created) {
      entry.createdAt = created;
      fixed++;
    }
    const updated = parseFinite(entry.updatedAt, entry.createdAt);
    if (entry.updatedAt !== updated) {
      entry.updatedAt = updated;
      fixed++;
    }
  }
  if (!isRecord(store.listings)) {
    store.listings = {};
    fixed++;
  }
  for (const [listingId, listing] of Object.entries(store.listings)) {
    if (!isRecord(listing) || typeof listing["id"] !== "string" || (listing["id"] as string).trim().length === 0) {
      delete store.listings[listingId];
      fixed++;
      continue;
    }
    const entry = listing as unknown as PlayerShopStore["listings"][string];
    const quantity = parseIntIn(entry.quantity, 1, 1000000, 1);
    if (entry.quantity !== quantity) {
      entry.quantity = quantity;
      fixed++;
    }
    const price = parseFloatIn(entry.pricePerUnit, store.config.minPricePerUnit, store.config.maxPricePerUnit, store.config.minPricePerUnit);
    if (entry.pricePerUnit !== price) {
      entry.pricePerUnit = price;
      fixed++;
    }
  }
  if (!isRecord(store.earningsByPlayerId)) {
    store.earningsByPlayerId = {};
    fixed++;
  }
  for (const [playerId, earnings] of Object.entries(store.earningsByPlayerId)) {
    if (!isRecord(earnings)) {
      delete store.earningsByPlayerId[playerId];
      fixed++;
      continue;
    }
    for (const [objective, amount] of Object.entries(earnings)) {
      const repaired = parseFloatIn(amount, 0, Number.MAX_SAFE_INTEGER, 0);
      if (amount !== repaired) {
        (store.earningsByPlayerId[playerId] as Record<string, number>)[objective] = repaired;
        fixed++;
      }
    }
  }
  return { ok: true, fixed };
}

export function validateClaims(claims: ClaimStore): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(claims)) return { ok: false, fixed: 0 };
  const store = claims as ClaimStore;
  if (!isRecord(store.config)) return { ok: false, fixed };
  const maxPerPlayer = parseIntIn(store.config.maxClaimsPerPlayer, 0, 100000, 3);
  if (store.config.maxClaimsPerPlayer !== maxPerPlayer) {
    store.config.maxClaimsPerPlayer = maxPerPlayer;
    fixed++;
  }
  const maxPerTeam = parseIntIn(store.config.maxClaimsPerTeam, 0, 100000, 10);
  if (store.config.maxClaimsPerTeam !== maxPerTeam) {
    store.config.maxClaimsPerTeam = maxPerTeam;
    fixed++;
  }
  const volume = parseFloatIn(store.config.maxClaimVolume, 1, Number.MAX_SAFE_INTEGER, 262144);
  if (store.config.maxClaimVolume !== volume) {
    store.config.maxClaimVolume = volume;
    fixed++;
  }
  if (!isRecord(store.claims)) {
    store.claims = {};
    fixed++;
    return { ok: true, fixed };
  }
  for (const [claimId, claim] of Object.entries(store.claims)) {
    if (!isRecord(claim) || typeof claim["id"] !== "string" || (claim["id"] as string).trim().length === 0) {
      delete store.claims[claimId];
      fixed++;
      continue;
    }
    const def = claim as unknown as ClaimStore["claims"][string];
    if (!isFiniteVector(def.min) || !isFiniteVector(def.max)) {
      delete store.claims[claimId];
      fixed++;
      continue;
    }
    if (typeof def.ownerPlayerId !== "string" || def.ownerPlayerId.trim().length === 0) {
      delete store.claims[claimId];
      fixed++;
      continue;
    }
    const priority = parseFinite(def.priority, 0);
    if (def.priority !== priority) {
      def.priority = priority;
      fixed++;
    }
    const created = parseFinite(def.createdAt, 0);
    if (def.createdAt !== created) {
      def.createdAt = created;
      fixed++;
    }
    const updated = parseFinite(def.updatedAt, def.createdAt);
    if (def.updatedAt !== updated) {
      def.updatedAt = updated;
      fixed++;
    }
    if (!isRecord(def.members)) {
      def.members = {};
      fixed++;
    }
    if (!isRecord(def.trustedTeams)) {
      def.trustedTeams = {};
      fixed++;
    }
  }
  return { ok: true, fixed };
}

export function validateCustomAreas(customAreas: CustomAreaStore): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(customAreas)) return { ok: false, fixed: 0 };
  const store = customAreas as CustomAreaStore;
  if (!isRecord(store.config)) return { ok: false, fixed };
  const interval = parseIntIn(store.config.checkIntervalTicks, 1, 1200, 10);
  if (store.config.checkIntervalTicks !== interval) {
    store.config.checkIntervalTicks = interval;
    fixed++;
  }
  const maxAreas = parseIntIn(store.config.maxAreas, 1, 10000, 250);
  if (store.config.maxAreas !== maxAreas) {
    store.config.maxAreas = maxAreas;
    fixed++;
  }
  if (!isRecord(store.areas)) {
    store.areas = {};
    fixed++;
    return { ok: true, fixed };
  }
  for (const [areaId, area] of Object.entries(store.areas)) {
    if (!isRecord(area) || typeof area["id"] !== "string" || (area["id"] as string).trim().length === 0) {
      delete store.areas[areaId];
      fixed++;
      continue;
    }
    const def = area as unknown as CustomAreaStore["areas"][string];
    if (!isFiniteVector(def.min) || !isFiniteVector(def.max)) {
      delete store.areas[areaId];
      fixed++;
      continue;
    }
    const priority = parseFinite(def.priority, 0);
    if (def.priority !== priority) {
      def.priority = priority;
      fixed++;
    }
    if (!Array.isArray(def.effects)) {
      def.effects = [];
      fixed++;
    } else {
      for (const effect of def.effects) {
        if (!isRecord(effect)) continue;
        const amplifier = parseIntIn(effect["amplifier"], 0, 255, 0);
        if (effect["amplifier"] !== amplifier) {
          effect["amplifier"] = amplifier;
          fixed++;
        }
        const duration = parseFloatIn(effect["durationSeconds"], 0, 1000000, 5);
        if (effect["durationSeconds"] !== duration) {
          effect["durationSeconds"] = duration;
          fixed++;
        }
        const effectInterval = parseIntIn(effect["intervalTicks"], 1, 1200, 20);
        if (effect["intervalTicks"] !== effectInterval) {
          effect["intervalTicks"] = effectInterval;
          fixed++;
        }
      }
    }
    if (!Array.isArray(def.commandRules)) {
      def.commandRules = [];
      fixed++;
    } else {
      for (const rule of def.commandRules) {
        if (!isRecord(rule)) continue;
        const ruleInterval = parseIntIn(rule["intervalTicks"], 1, 1200, 20);
        if (rule["intervalTicks"] !== ruleInterval) {
          rule["intervalTicks"] = ruleInterval;
          fixed++;
        }
      }
    }
  }
  return { ok: true, fixed };
}

export function validateLootChests(lootChests: LootChestStore): StoreValidationResult {
  let fixed = 0;
  if (!isRecord(lootChests)) return { ok: false, fixed: 0 };
  const store = lootChests as LootChestStore;
  if (!isRecord(store.config)) return { ok: false, fixed };
  const processInterval = parseIntIn(store.config.processIntervalTicks, 1, 1200, 20);
  if (store.config.processIntervalTicks !== processInterval) {
    store.config.processIntervalTicks = processInterval;
    fixed++;
  }
  const maxRefills = parseIntIn(store.config.maxRefillsPerTick, 1, 1000, 4);
  if (store.config.maxRefillsPerTick !== maxRefills) {
    store.config.maxRefillsPerTick = maxRefills;
    fixed++;
  }
  const defaultRespawn = parseIntIn(store.config.defaultRespawnTicks, 1, 20 * 60 * 60 * 24, 20 * 60 * 10);
  if (store.config.defaultRespawnTicks !== defaultRespawn) {
    store.config.defaultRespawnTicks = defaultRespawn;
    fixed++;
  }
  if (!isRecord(store.pools)) {
    store.pools = {};
    fixed++;
  }
  for (const [poolId, pool] of Object.entries(store.pools)) {
    if (!isRecord(pool) || typeof pool["id"] !== "string" || (pool["id"] as string).trim().length === 0) {
      delete store.pools[poolId];
      fixed++;
      continue;
    }
    const entry = pool as unknown as LootChestStore["pools"][string];
    if (!Array.isArray(entry.snapshotIds)) {
      entry.snapshotIds = [];
      fixed++;
    }
  }
  if (!isRecord(store.snapshots)) {
    store.snapshots = {};
    fixed++;
  }
  for (const [snapshotKey, snapshot] of Object.entries(store.snapshots)) {
    if (!isRecord(snapshot) || typeof snapshot["id"] !== "string" || typeof snapshot["poolId"] !== "string") {
      delete store.snapshots[snapshotKey];
      fixed++;
      continue;
    }
    const entry = snapshot as unknown as LootChestStore["snapshots"][string];
    const weight = Number.isFinite(entry.weight) && entry.weight > 0 ? entry.weight : 1;
    if (entry.weight !== weight) {
      entry.weight = weight;
      fixed++;
    }
    const containerSize = parseIntIn(entry.containerSize, 1, 54, 27);
    if (entry.containerSize !== containerSize) {
      entry.containerSize = containerSize;
      fixed++;
    }
    if (!Array.isArray(entry.items)) {
      entry.items = [];
      fixed++;
    }
  }
  if (!isRecord(store.chests)) {
    store.chests = {};
    fixed++;
  }
  for (const [chestId, chest] of Object.entries(store.chests)) {
    if (
      !isRecord(chest) ||
      typeof chest["id"] !== "string" ||
      typeof chest["poolId"] !== "string" ||
      !Number.isFinite(chest["x"]) ||
      !Number.isFinite(chest["y"]) ||
      !Number.isFinite(chest["z"])
    ) {
      delete store.chests[chestId];
      fixed++;
      continue;
    }
    const entry = chest as unknown as LootChestStore["chests"][string];
    const respawn = parseIntIn(entry.respawnTicks, 1, 20 * 60 * 60 * 24, store.config.defaultRespawnTicks);
    if (entry.respawnTicks !== respawn) {
      entry.respawnTicks = respawn;
      fixed++;
    }
  }
  return { ok: true, fixed };
}

export function validateAllStores(slices: AllStoreSlices): StoreValidationSummary {
  const perStore: Record<string, number> = {};
  let fixed = 0;
  let ok = true;
  const runs: Array<{ name: string; result: StoreValidationResult }> = [
    { name: "forms", result: validateForms(slices.forms) },
    { name: "shops", result: validateShops(slices.shops) },
    { name: "teams", result: validateTeams(slices.teams) },
    { name: "homes", result: validateHomes(slices.homes) },
    { name: "generators", result: validateGenerators(slices.generators) },
    { name: "crates", result: validateCrates(slices.crates) },
    { name: "tauItems", result: validateTauItems(slices.tauItems) },
    { name: "playerShops", result: validatePlayerShops(slices.playerShops) },
    { name: "claims", result: validateClaims(slices.claims) },
    { name: "customAreas", result: validateCustomAreas(slices.customAreas) },
    { name: "lootChests", result: validateLootChests(slices.lootChests) },
  ];
  for (const run of runs) {
    if (!run.result.ok) ok = false;
    if (run.result.fixed > 0) {
      perStore[run.name] = run.result.fixed;
      fixed += run.result.fixed;
    }
  }
  return { ok, fixed, perStore };
}
