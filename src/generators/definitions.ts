import { BlockPermutation, ItemStack, world } from "@minecraft/server";
import { saveGenerators, state } from "../storage";
import type { GeneratorDefinition, GeneratorOutputEntry, GeneratorTierDefinition, GeneratorStore, PlacedGenerator } from "../types/game";
import { generatorCache, GENERATOR_MARKER_PREFIX, type GeneratorItemData, type GeneratorLocation } from "./types";
import { normalizeItemId } from "../shared/item-id";
import { getValidOutputPool } from "./output-pick";

export const MAX_GENERATOR_POOL_SIZE = 32;

function normalizeId(value: string): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
}

function parsePlotIndex(slotId: string): number {
  const match = /^plot_(\d+)$/.exec(slotId);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const index = Number(match[1]);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
}

function readGeneratorItemData(itemStack?: ItemStack): GeneratorItemData | undefined {
  if (!itemStack) return undefined;
  for (const line of itemStack.getLore()) {
    if (!line.startsWith(GENERATOR_MARKER_PREFIX) || !line.endsWith("]")) continue;
    const payload = line.slice(GENERATOR_MARKER_PREFIX.length, -1);
    const [definitionIdRaw, tierRaw, purchasedRaw, enabledRaw] = payload.split(":");
    const tier = Math.floor(Number(tierRaw ?? "1"));
    return {
      definitionId: normalizeId(definitionIdRaw),
      tier: Number.isFinite(tier) && tier > 0 ? tier : 1,
      autoBreakerPurchased: purchasedRaw === "1",
      autoBreakerEnabled: enabledRaw === "1",
    };
  }
  return undefined;
}

function getMaxTier(definition: GeneratorDefinition): number {
  return definition.tiers.length === 0 ? 1 : Math.max(...definition.tiers.map((entry) => entry.tier));
}

function getMaxTierEntry(definition: GeneratorDefinition): GeneratorTierDefinition | undefined {
  const sorted = definition.tiers.slice().sort((a, b) => a.tier - b.tier);
  return sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
}

function getTier(definition: GeneratorDefinition, tier: number): GeneratorTierDefinition | undefined {
  return definition.tiers.find((entry) => entry.tier === tier);
}

function getDefinitions(): GeneratorDefinition[] {
  if (generatorCache.source === state.generators.definitions && generatorCache.definitions) return generatorCache.definitions;
  generatorCache.source = state.generators.definitions;
  generatorCache.definitions = Object.values(state.generators.definitions);
  return generatorCache.definitions;
}

function getDefinitionByStack(itemStack?: ItemStack): GeneratorDefinition | undefined {
  const data = readGeneratorItemData(itemStack);
  if (!data) return undefined;
  return state.generators.definitions[data.definitionId];
}

function clearGeneratorOutput(location: GeneratorLocation, preserveBase = false): void {
  try {
    const dim = world.getDimension(location.dimensionId);
    const base = dim.getBlock({ x: location.x, y: location.y, z: location.z });
    const output = dim.getBlock({ x: location.x, y: location.y + 1, z: location.z });
    if (!preserveBase && base) base.setType("minecraft:air");
    if (output) output.setType("minecraft:air");
  } catch {
  }
}

function restoreGeneratorBlocks(placed: PlacedGenerator, preserveBase = false): void {
  try {
    const dim = world.getDimension(placed.dimensionId);
    const base = dim.getBlock({ x: placed.x, y: placed.y, z: placed.z });
    const output = dim.getBlock({ x: placed.x, y: placed.y + 1, z: placed.z });
    if (!preserveBase && base) base.setPermutation(BlockPermutation.resolve(placed.originalBaseBlockId ?? "minecraft:air"));
    if (output) output.setPermutation(BlockPermutation.resolve(placed.originalOutputBlockId ?? "minecraft:air"));
  } catch {
  }
}

export function getGeneratorAutoBreakerCost(definition: GeneratorDefinition): number {
  if (definition.autoBreakerCost !== undefined && Number.isFinite(definition.autoBreakerCost)) {
    return Math.max(0, Math.floor(definition.autoBreakerCost));
  }
  const finalTier = getMaxTierEntry(definition);
  return Math.max(0, Math.floor((finalTier?.upgradeCost ?? 0) * 2));
}

export function listGeneratorDefinitions(): GeneratorDefinition[] {
  return getDefinitions().slice().sort((a, b) => a.name.localeCompare(b.name));
}

export function getGeneratorDefinition(defId: string): GeneratorDefinition | undefined {
  return state.generators.definitions[normalizeId(defId)];
}

export function deleteGeneratorDefinition(defId: string): { ok: boolean; message: string } {
  const id = normalizeId(defId);
  const def = state.generators.definitions[id];
  if (!def) return { ok: false, message: "Generator not found." };

  for (const [placedId, placed] of Object.entries(state.generators.placed)) {
    if (placed.definitionId === id) {
      restoreGeneratorBlocks(placed);
      delete state.generators.placed[placedId];
    }
  }

  delete state.generators.definitions[id];
  generatorCache.definitions = undefined;
  generatorCache.source = undefined;
  saveGenerators();
  return { ok: true, message: `Deleted generator ${def.name}.` };
}

export function updateGeneratorDefinition(defId: string, partial: Partial<Pick<GeneratorDefinition, "name" | "baseItemId" | "outputItemId" | "displayName" | "placeAnywhere" | "lore" | "customData" | "enchantments" | "durability" | "maxDurability" | "canPlaceOn" | "canDestroy" | "autoBreakerCost" | "adminProtected">>): { ok: boolean; message: string } {
  const def = state.generators.definitions[normalizeId(defId)];
  if (!def) return { ok: false, message: "Generator not found." };

  if (partial.name !== undefined) def.name = String(partial.name).trim() || def.name;
  if (partial.baseItemId !== undefined) def.baseItemId = normalizeItemId(partial.baseItemId);
  if (partial.outputItemId !== undefined) def.outputItemId = normalizeItemId(partial.outputItemId);
  if (partial.displayName !== undefined) def.displayName = String(partial.displayName).trim() || def.displayName;
  if (partial.placeAnywhere !== undefined) def.placeAnywhere = Boolean(partial.placeAnywhere);
  if (partial.lore !== undefined) def.lore = partial.lore;
  if (partial.customData !== undefined) def.customData = partial.customData;
  if (partial.enchantments !== undefined) def.enchantments = partial.enchantments;
  if (partial.durability !== undefined) def.durability = partial.durability;
  if (partial.maxDurability !== undefined) def.maxDurability = partial.maxDurability;
  if (partial.canPlaceOn !== undefined) def.canPlaceOn = partial.canPlaceOn;
  if (partial.canDestroy !== undefined) def.canDestroy = partial.canDestroy;
  if (partial.autoBreakerCost !== undefined) def.autoBreakerCost = partial.autoBreakerCost;
  if (partial.adminProtected !== undefined) def.adminProtected = Boolean(partial.adminProtected);

  generatorCache.definitions = undefined;
  generatorCache.source = undefined;
  saveGenerators();
  return { ok: true, message: `Updated generator ${def.name}.` };
}

export function createGeneratorDefinition(
  name: string,
  baseItemId: string,
  outputItemId: string,
  rateTicks: number,
  adminProtected = false
): { ok: boolean; message: string } {
  const id = normalizeId(name);
  if (!id) return { ok: false, message: "Generator name is required." };
  if (state.generators.definitions[id]) return { ok: false, message: "That generator already exists." };

  state.generators.definitions[id] = {
    id,
    name: String(name).trim(),
    kind: "fixed",
    baseItemId: normalizeItemId(baseItemId),
    outputItemId: normalizeItemId(outputItemId),
    displayName: String(name).trim(),
    lore: undefined,
    customData: undefined,
    enchantments: undefined,
    durability: undefined,
    maxDurability: undefined,
    canPlaceOn: undefined,
    canDestroy: undefined,
    autoBreakerCost: undefined,
    tiers: [{ tier: 1, rateTicks: Math.max(0, Math.floor(rateTicks)), upgradeCost: 0 }],
    placeAnywhere: state.generators.config.defaultPlaceAnywhere,
    adminProtected: Boolean(adminProtected),
  };
  generatorCache.definitions = undefined;
  generatorCache.source = undefined;
  saveGenerators();
  return { ok: true, message: `Created generator ${name}.` };
}

export function addGeneratorTier(defId: string, rateTicks: number, upgradeCost: number): { ok: boolean; message: string } {
  const def = state.generators.definitions[normalizeId(defId)];
  if (!def) return { ok: false, message: "Generator not found." };
  const nextTier = def.tiers.length === 0 ? 1 : Math.max(...def.tiers.map((tier) => tier.tier)) + 1;
  def.tiers.push({
    tier: nextTier,
    rateTicks: Math.max(0, Math.floor(rateTicks)),
    upgradeCost: Math.max(0, Math.floor(upgradeCost)),
  });
  generatorCache.definitions = undefined;
  generatorCache.source = undefined;
  saveGenerators();
  return { ok: true, message: `Added tier ${nextTier}.` };
}

export function updateGeneratorTier(defId: string, tierNumber: number, partial: Partial<Pick<GeneratorTierDefinition, "rateTicks" | "upgradeCost">>): { ok: boolean; message: string } {
  const def = state.generators.definitions[normalizeId(defId)];
  if (!def) return { ok: false, message: "Generator not found." };
  const tier = def.tiers.find((entry) => entry.tier === Math.floor(tierNumber));
  if (!tier) return { ok: false, message: "Tier not found." };

  if (partial.rateTicks !== undefined) tier.rateTicks = Math.max(0, Math.floor(Number(partial.rateTicks)));
  if (partial.upgradeCost !== undefined) tier.upgradeCost = Math.max(0, Math.floor(Number(partial.upgradeCost)));

  saveGenerators();
  return { ok: true, message: `Updated tier ${tier.tier}.` };
}

export function removeGeneratorTier(defId: string, tierNumber: number): { ok: boolean; message: string } {
  const def = state.generators.definitions[normalizeId(defId)];
  if (!def) return { ok: false, message: "Generator not found." };
  if (def.tiers.length <= 1) return { ok: false, message: "A generator must have at least one tier." };
  const tierIndex = def.tiers.findIndex((entry) => entry.tier === Math.floor(tierNumber));
  if (tierIndex < 0) return { ok: false, message: "Tier not found." };

  const removedTier = def.tiers[tierIndex];
  def.tiers.splice(tierIndex, 1);
  const maxTier = Math.max(...def.tiers.map((entry) => entry.tier));
  def.tiers = def.tiers
    .map((entry) => ({ ...entry, tier: entry.tier > removedTier.tier ? entry.tier - 1 : entry.tier }))
    .sort((a, b) => a.tier - b.tier);

  for (const placed of Object.values(state.generators.placed)) {
    if (placed.definitionId !== def.id) continue;
    if (placed.tier > maxTier) placed.tier = maxTier;
  }

  saveGenerators();
  return { ok: true, message: `Removed tier ${tierNumber}.` };
}

export function createWeightedGeneratorDefinition(
  name: string,
  baseItemId: string,
  initialPool: GeneratorOutputEntry[],
  rateTicks: number,
  adminProtected = false
): { ok: boolean; message: string } {
  const id = normalizeId(name);
  if (!id) return { ok: false, message: "Generator name is required." };
  if (state.generators.definitions[id]) return { ok: false, message: "That generator already exists." };

  const pool = initialPool
    .map((entry) => ({
      itemId: normalizeItemId(entry.itemId),
      weight: Math.max(1, Math.floor(Number(entry.weight) || 1)),
    }))
    .filter((entry) => entry.itemId.length > 0)
    .slice(0, MAX_GENERATOR_POOL_SIZE);
  if (pool.length === 0) return { ok: false, message: "Weighted generators need at least one pool entry." };

  state.generators.definitions[id] = {
    id,
    name: String(name).trim(),
    kind: "weighted",
    baseItemId: normalizeItemId(baseItemId),
    outputItemId: pool[0].itemId,
    outputPool: pool,
    displayName: String(name).trim(),
    lore: undefined,
    customData: undefined,
    enchantments: undefined,
    durability: undefined,
    maxDurability: undefined,
    canPlaceOn: undefined,
    canDestroy: undefined,
    autoBreakerCost: undefined,
    tiers: [{ tier: 1, rateTicks: Math.max(0, Math.floor(rateTicks)), upgradeCost: 0 }],
    placeAnywhere: state.generators.config.defaultPlaceAnywhere,
    adminProtected: Boolean(adminProtected),
  };
  generatorCache.definitions = undefined;
  generatorCache.source = undefined;
  saveGenerators();
  return { ok: true, message: `Created weighted generator ${name}.` };
}

export function isGeneratorAdminProtected(definition: GeneratorDefinition | undefined): boolean {
  return Boolean(definition?.adminProtected);
}

export function addGeneratorOutputEntry(defId: string, itemId: string, weight: number): { ok: boolean; message: string } {
  const def = state.generators.definitions[normalizeId(defId)];
  if (!def) return { ok: false, message: "Generator not found." };
  if (def.kind !== "weighted") return { ok: false, message: "That generator is not weighted." };
  const pool = def.outputPool ?? [];
  if (pool.length >= MAX_GENERATOR_POOL_SIZE) return { ok: false, message: `Pool cannot exceed ${MAX_GENERATOR_POOL_SIZE} entries.` };

  pool.push({
    itemId: normalizeItemId(itemId),
    weight: Math.max(1, Math.floor(Number(weight) || 1)),
  });
  def.outputPool = pool;
  if (!def.outputItemId) def.outputItemId = pool[0].itemId;
  generatorCache.definitions = undefined;
  generatorCache.source = undefined;
  saveGenerators();
  return { ok: true, message: "Added pool entry." };
}

export function updateGeneratorOutputEntry(
  defId: string,
  index: number,
  partial: Partial<Pick<GeneratorOutputEntry, "itemId" | "weight">>
): { ok: boolean; message: string } {
  const def = state.generators.definitions[normalizeId(defId)];
  if (!def) return { ok: false, message: "Generator not found." };
  if (def.kind !== "weighted") return { ok: false, message: "That generator is not weighted." };
  const pool = def.outputPool ?? [];
  const entry = pool[Math.floor(index)];
  if (!entry) return { ok: false, message: "Pool entry not found." };

  if (partial.itemId !== undefined) entry.itemId = normalizeItemId(partial.itemId);
  if (partial.weight !== undefined) entry.weight = Math.max(1, Math.floor(Number(partial.weight) || 1));

  generatorCache.definitions = undefined;
  generatorCache.source = undefined;
  saveGenerators();
  return { ok: true, message: "Updated pool entry." };
}

export function removeGeneratorOutputEntry(defId: string, index: number): { ok: boolean; message: string } {
  const def = state.generators.definitions[normalizeId(defId)];
  if (!def) return { ok: false, message: "Generator not found." };
  if (def.kind !== "weighted") return { ok: false, message: "That generator is not weighted." };
  const pool = def.outputPool ?? [];
  if (pool.length <= 1) return { ok: false, message: "A weighted generator must keep at least one pool entry." };
  const entryIndex = Math.floor(index);
  if (entryIndex < 0 || entryIndex >= pool.length) return { ok: false, message: "Pool entry not found." };

  pool.splice(entryIndex, 1);
  def.outputPool = pool;
  def.outputItemId = pool[0]?.itemId ?? def.outputItemId;
  generatorCache.definitions = undefined;
  generatorCache.source = undefined;
  saveGenerators();
  return { ok: true, message: "Removed pool entry." };
}

export function getGeneratorOutputChanceText(defId: string, index: number): string {
  const def = getGeneratorDefinition(defId);
  if (!def || def.kind !== "weighted") return "0%";
  const pool = def.outputPool ?? [];
  const entry = pool[Math.floor(index)];
  if (!entry || !Number.isFinite(entry.weight) || entry.weight <= 0) return "0%";
  const valid = getValidOutputPool(def);
  const total = valid.reduce((sum, poolEntry) => sum + poolEntry.weight, 0);
  if (total <= 0) return "0%";
  const chance = (entry.weight / total) * 100;
  return `${chance.toFixed(chance >= 10 ? 1 : 2)}%`;
}

export function getGeneratorInfoLines(defId: string): string[] {
  const def = getGeneratorDefinition(defId);
  if (!def) return ["Generator not found."];
  const lines: string[] = [];
  const topTier = def.tiers.slice().sort((a, b) => a.tier - b.tier)[0];
  const sortedTiers = def.tiers.slice().sort((a, b) => a.tier - b.tier);
  const highestTier = sortedTiers.length > 0 ? sortedTiers[sortedTiers.length - 1] : undefined;
  lines.push(`Name: ${def.name}`);
  lines.push(`Type: ${def.kind === "weighted" ? "weighted pool" : "fixed"}`);
  lines.push(`Admin protected: ${def.adminProtected ? "yes" : "no"}`);
  if (def.kind === "weighted") {
    const pool = getValidOutputPool(def);
    lines.push(`Pool: ${pool.length} entries`);
    for (let i = 0; i < Math.min(pool.length, 5); i++) {
      const entry = pool[i];
      lines.push(`  - ${entry.itemId} (${entry.weight}, ${getGeneratorOutputChanceText(def.id, i)})`);
    }
    if (pool.length > 5) lines.push(`  … and ${pool.length - 5} more`);
  } else {
    lines.push(`Output: ${def.outputItemId}`);
  }
  lines.push(`Base: ${def.baseItemId}`);
  lines.push(`Place anywhere: ${def.placeAnywhere ? "yes" : "no"}`);
  lines.push(`Tiers: ${def.tiers.length}`);
  if (topTier) lines.push(`Tier 1 speed: ${topTier.rateTicks} ticks${topTier.rateTicks === 0 ? " (turbo)" : ""}`);
  if (highestTier && highestTier !== topTier) {
    lines.push(`Max tier ${highestTier.tier} speed: ${highestTier.rateTicks} ticks${highestTier.rateTicks === 0 ? " (turbo)" : ""}`);
  }
  lines.push(`Autobreaker cost: ${getGeneratorAutoBreakerCost(def)}${def.autoBreakerCost !== undefined ? " (custom)" : " (default)"}`);
  return lines;
}

export function getGeneratorTierSummary(defId: string, tierNumber: number): string | undefined {
  const def = getGeneratorDefinition(defId);
  if (!def) return undefined;
  const tier = def.tiers.find((entry) => entry.tier === tierNumber);
  if (!tier) return undefined;
  const turbo = tier.rateTicks === 0 ? ", turbo" : "";
  return `Tier ${tier.tier}: speed ${tier.rateTicks} ticks${turbo}, upgrade cost ${tier.upgradeCost}`;
}

export function updateGeneratorConfig(partial: Partial<GeneratorStore["config"]>): { ok: boolean; message: string } {
  if (partial.enabled !== undefined) state.generators.config.enabled = Boolean(partial.enabled);
  if (partial.defaultPlaceAnywhere !== undefined) state.generators.config.defaultPlaceAnywhere = Boolean(partial.defaultPlaceAnywhere);
  if (partial.blockOnPlotOnly !== undefined) state.generators.config.blockOnPlotOnly = Boolean(partial.blockOnPlotOnly);
  if (partial.autoBreakersEnabled !== undefined) state.generators.config.autoBreakersEnabled = Boolean(partial.autoBreakersEnabled);
  if (partial.maxTurboSpawnsPerCycle !== undefined) {
    state.generators.config.maxTurboSpawnsPerCycle = Math.max(1, Math.floor(Number(partial.maxTurboSpawnsPerCycle) || 32));
  }
  saveGenerators();
  return { ok: true, message: "Generator settings updated." };
}

export { normalizeId, normalizeItemId, parsePlotIndex, getMaxTier, getMaxTierEntry, getTier, getDefinitions, getDefinitionByStack, readGeneratorItemData, clearGeneratorOutput, restoreGeneratorBlocks };
