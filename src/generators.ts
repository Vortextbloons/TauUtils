import { BlockPermutation, Direction, ItemStack, Player, Vector3, world } from "@minecraft/server";
import { getPlayerId } from "./storage";
import { getPlayerTeam } from "./teams";
import { getScore, isOperator, saveGenerators, setScore, state, tell } from "./storage";
import { type GeneratorDefinition, type GeneratorTierDefinition, type GeneratorStore, type PlacedGenerator } from "./tau-models";
import { getPlotForLocation, getPlotOwnerIdForPlayer, savePlotAtLocation } from "./plots";

type GeneratorLocation = {
  dimensionId: string;
  x: number;
  y: number;
  z: number;
};

function normalizeId(value: string): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeItemId(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes(":")) return trimmed;
  return `minecraft:${trimmed.toLowerCase()}`;
}

function parsePlotIndex(slotId: string): number {
  const match = /^plot_(\d+)$/.exec(slotId);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const index = Number(match[1]);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
}

function stripFormatting(value: string): string {
  return String(value ?? "").replace(/§./g, "").trim();
}

const GENERATOR_MARKER_PREFIX = "§0[TAU_GENERATOR:";
const GENERATOR_TIER_PREFIX = "§7Tier: §f";
type GeneratorItemData = {
  definitionId: string;
  tier: number;
  autoBreakerPurchased: boolean;
  autoBreakerEnabled: boolean;
};

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

function readGeneratorTier(itemStack?: ItemStack): number {
  const data = readGeneratorItemData(itemStack);
  if (data) return data.tier;
  if (!itemStack) return 1;
  for (const line of itemStack.getLore()) {
    if (line.startsWith(GENERATOR_TIER_PREFIX)) {
      const tier = Math.floor(Number(line.slice(GENERATOR_TIER_PREFIX.length).trim()));
      if (Number.isFinite(tier) && tier > 0) return tier;
    }
  }
  return 1;
}

function readGeneratorAutoBreakerState(itemStack?: ItemStack): { purchased: boolean; enabled: boolean } {
  const data = readGeneratorItemData(itemStack);
  if (data) {
    return {
      purchased: data.autoBreakerPurchased,
      enabled: data.autoBreakerEnabled,
    };
  }
  return { purchased: false, enabled: false };
}

function getMaxTier(definition: GeneratorDefinition): number {
  return definition.tiers.length === 0 ? 1 : Math.max(...definition.tiers.map((entry) => entry.tier));
}

function getMaxTierEntry(definition: GeneratorDefinition): GeneratorTierDefinition | undefined {
  const sorted = definition.tiers.slice().sort((a, b) => a.tier - b.tier);
  return sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
}

export function getGeneratorAutoBreakerCost(definition: GeneratorDefinition): number {
  if (definition.autoBreakerCost !== undefined && Number.isFinite(definition.autoBreakerCost)) {
    return Math.max(0, Math.floor(definition.autoBreakerCost));
  }
  const finalTier = getMaxTierEntry(definition);
  return Math.max(0, Math.floor((finalTier?.upgradeCost ?? 0) * 2));
}

function isAutoBreakerUnlocked(placed: PlacedGenerator, definition: GeneratorDefinition): boolean {
  return state.generators.config.autoBreakersEnabled && Boolean(placed.autoBreakerPurchased) && Boolean(placed.autoBreakerEnabled) && placed.tier >= getMaxTier(definition);
}

function normalizePlacedTier(definition: GeneratorDefinition, tier: number): number {
  return Math.max(1, Math.min(getMaxTier(definition), Math.floor(tier) || 1));
}

function createPlacedGenerator(def: GeneratorDefinition, ownerPlayerId: string, dimensionId: string, loc: GeneratorLocation, stack: ItemStack): PlacedGenerator {
  const tier = normalizePlacedTier(def, readGeneratorTier(stack));
  const autoBreaker = readGeneratorAutoBreakerState(stack);
  const tierEntry = getTier(def, tier);
  return {
    id: locationKey(loc),
    definitionId: def.id,
    ownerPlayerId,
    dimensionId,
    x: loc.x,
    y: loc.y,
    z: loc.z,
    tier,
    nextSpawnAt: Date.now() + (tierEntry?.rateTicks ?? 100) * 50,
    autoBreakerPurchased: autoBreaker.purchased,
    autoBreakerEnabled: autoBreaker.enabled,
  };
}

function buildGeneratorLore(def: GeneratorDefinition, tier: number, autoBreakerPurchased = false, autoBreakerEnabled = false): string[] {
  const lore: string[] = [];
  if (def.lore && def.lore.length > 0) lore.push(...def.lore);
  lore.push(`§6Generator: §f${def.name}`);
  lore.push(`§7ID: §f${def.id}`);
  lore.push(`${GENERATOR_TIER_PREFIX}${tier}`);
  if (autoBreakerPurchased) {
    lore.push(`§eAutobreaker§r: §f${autoBreakerEnabled ? "On" : "Off"}`);
  }
  lore.push(`${GENERATOR_MARKER_PREFIX}${def.id}:${tier}:${autoBreakerPurchased ? 1 : 0}:${autoBreakerEnabled ? 1 : 0}]`);
  return lore;
}

function getGeneratorOwnerName(ownerPlayerId: string): string {
  return Object.entries(state.stats.playerIds).find(([, id]) => id === ownerPlayerId)?.[0] ?? ownerPlayerId;
}

function getDefinitionByStack(itemStack?: ItemStack): GeneratorDefinition | undefined {
  const data = readGeneratorItemData(itemStack);
  if (!data) return undefined;
  return state.generators.definitions[data.definitionId];
}

function canAccessTeamPlotGenerator(player: Player, location: GeneratorLocation): boolean {
  const team = getPlayerTeam(player);
  if (!team?.teamPlotEnabled) return false;
  const plot = getPlotForLocation(location);
  if (!plot || plot.occupiedByPlayerId !== team.ownerPlayerId) return false;

  const playerId = getPlayerId(player);
  return playerId === team.ownerPlayerId || team.memberPlayerIds.includes(playerId);
}

function isGeneratorOwnerActive(placed: PlacedGenerator, onlineIds: Set<string>): boolean {
  if (onlineIds.has(placed.ownerPlayerId)) return true;

  const team = Object.values(state.teams.teams).find((entry) => entry.ownerPlayerId === placed.ownerPlayerId && entry.teamPlotEnabled);
  if (!team) return false;

  return team.memberPlayerIds.some((memberId) => onlineIds.has(memberId));
}

function consumePlacedGeneratorItem(player: Player, def: GeneratorDefinition): boolean {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return false;
  const slotIndex = player.selectedSlotIndex;
  const current = inventory.getItem(slotIndex);
  if (!current) return false;
  const currentDef = getDefinitionByStack(current);
  if (!currentDef || currentDef.id !== def.id) return false;

  if (current.amount > 1) {
    current.amount -= 1;
    inventory.setItem(slotIndex, current);
  } else {
    inventory.setItem(slotIndex, undefined);
  }
  return true;
}

function addItemWithoutMergingMetadata(container: { size: number; getItem(slot: number): ItemStack | undefined; setItem(slot: number, item?: ItemStack): void }, stack: ItemStack): boolean {
  for (let slot = 0; slot < container.size; slot++) {
    const current = container.getItem(slot);
    if (!current) {
      container.setItem(slot, stack);
      return true;
    }

    if (current.typeId !== stack.typeId || current.amount < 1) continue;
    if (String(current.nameTag ?? "") !== String(stack.nameTag ?? "")) continue;
    const currentLore = current.getLore();
    const stackLore = stack.getLore();
    if (currentLore.length !== stackLore.length || currentLore.some((line, index) => line !== stackLore[index])) continue;
    current.amount += stack.amount;
    container.setItem(slot, current);
    return true;
  }

  return false;
}

function offsetByFace(location: Vector3, dimensionId: string, face?: Direction): GeneratorLocation {
  const x = Math.floor(location.x);
  const y = Math.floor(location.y);
  const z = Math.floor(location.z);
  switch (face) {
    case Direction.Up:
      return { dimensionId, x, y: y + 1, z };
    case Direction.Down:
      return { dimensionId, x, y: y - 1, z };
    case Direction.East:
      return { dimensionId, x: x + 1, y, z };
    case Direction.West:
      return { dimensionId, x: x - 1, y, z };
    case Direction.North:
      return { dimensionId, x, y, z: z + 1 };
    case Direction.South:
      return { dimensionId, x, y, z: z - 1 };
    default:
      return { dimensionId, x, y, z };
  }
}

function locationKey(location: GeneratorLocation): string {
  return `${location.dimensionId}:${Math.floor(location.x)}:${Math.floor(location.y)}:${Math.floor(location.z)}`;
}

let cachedDefinitions: GeneratorDefinition[] | undefined;
let cachedDefinitionsSource: Record<string, GeneratorDefinition> | undefined;

function getDefinitions(): GeneratorDefinition[] {
  if (cachedDefinitionsSource === state.generators.definitions && cachedDefinitions) return cachedDefinitions;
  cachedDefinitionsSource = state.generators.definitions;
  cachedDefinitions = Object.values(state.generators.definitions);
  return cachedDefinitions;
}

function blockLocationFromVector(location: Vector3, dimensionId: string): GeneratorLocation {
  return {
    dimensionId,
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}

function getTier(definition: GeneratorDefinition, tier: number): GeneratorTierDefinition | undefined {
  return definition.tiers.find((entry) => entry.tier === tier);
}

function getGeneratorAtLocation(location: GeneratorLocation): PlacedGenerator | undefined {
  return state.generators.placed[locationKey(location)];
}

function getGeneratorAtLocationKey(key: string): PlacedGenerator | undefined {
  return state.generators.placed[key];
}

function canPlaceAt(location: GeneratorLocation, player?: Player): boolean {
  if (state.generators.config.blockOnPlotOnly && !(player && isOperator(player))) {
    const slot = Object.values(state.plots.slots).slice().sort((a, b) => parsePlotIndex(a.id) - parsePlotIndex(b.id) || a.id.localeCompare(b.id)).find((entry) =>
      location.x >= entry.min.x && location.x <= entry.max.x &&
      location.y >= entry.min.y && location.y <= entry.max.y &&
      location.z >= entry.min.z && location.z <= entry.max.z
    );
    if (!slot) return false;
  }
  return !getGeneratorAtLocation(location);
}

function isSamePlotFootprint(base: GeneratorLocation, output: GeneratorLocation): boolean {
  const basePlot = getPlotForLocation(base);
  const outputPlot = getPlotForLocation(output);
  if (!basePlot && !outputPlot) return true;
  if (!basePlot || !outputPlot) return false;
  return basePlot.id === outputPlot.id;
}

function clearGeneratorOutput(location: GeneratorLocation, preserveBase = false): void {
  try {
    const dim = world.getDimension(location.dimensionId);
    const base = dim.getBlock({ x: location.x, y: location.y, z: location.z });
    const output = dim.getBlock({ x: location.x, y: location.y + 1, z: location.z });
    if (!preserveBase && base) base.setType("minecraft:air");
    if (output) output.setType("minecraft:air");
  } catch {
    // Ignore cleanup failures.
  }
}

function getTopBlock(location: GeneratorLocation) {
  try {
    return world.getDimension(location.dimensionId).getBlock({ x: location.x, y: location.y + 1, z: location.z });
  } catch {
    return undefined;
  }
}

function spawnGeneratorOutput(location: GeneratorLocation, definition: GeneratorDefinition, amount: number): boolean {
  try {
    const dim = world.getDimension(location.dimensionId);
    const baseBlock = dim.getBlock({ x: location.x, y: location.y, z: location.z });
    const outputBlock = dim.getBlock({ x: location.x, y: location.y + 1, z: location.z });
    if (!baseBlock || !outputBlock) return false;
    baseBlock.setPermutation(BlockPermutation.resolve("minecraft:bedrock"));
    outputBlock.setPermutation(BlockPermutation.resolve(normalizeItemId(definition.outputItemId)));
    return true;
  } catch {
    return false;
  }
}

function collectGeneratorOutput(player: Player, definition: GeneratorDefinition, amount: number): void {
  try {
    const stack = new ItemStack(normalizeItemId(definition.outputItemId), Math.max(1, Math.floor(amount)));
    const inventory = player.getComponent("minecraft:inventory")?.container;
    if (!inventory) {
      player.dimension.spawnItem(stack, player.location);
      return;
    }
    const leftover = inventory.addItem(stack);
    if (leftover) player.dimension.spawnItem(leftover, player.location);
  } catch {
    // ignore
  }
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
      clearGeneratorOutput({ dimensionId: placed.dimensionId, x: placed.x, y: placed.y, z: placed.z });
      delete state.generators.placed[placedId];
    }
  }

  delete state.generators.definitions[id];
  cachedDefinitions = undefined;
  cachedDefinitionsSource = undefined;
  saveGenerators();
  return { ok: true, message: `Deleted generator ${def.name}.` };
}

export function updateGeneratorDefinition(defId: string, partial: Partial<Pick<GeneratorDefinition, "name" | "baseItemId" | "outputItemId" | "displayName" | "placeAnywhere" | "lore" | "customData" | "enchantments" | "durability" | "maxDurability" | "canPlaceOn" | "canDestroy" | "autoBreakerCost">>): { ok: boolean; message: string } {
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

  cachedDefinitions = undefined;
  cachedDefinitionsSource = undefined;
  saveGenerators();
  return { ok: true, message: `Updated generator ${def.name}.` };
}

export function createGeneratorDefinition(name: string, baseItemId: string, outputItemId: string, rateTicks: number): { ok: boolean; message: string } {
  const id = normalizeId(name);
  if (!id) return { ok: false, message: "Generator name is required." };
  if (state.generators.definitions[id]) return { ok: false, message: "That generator already exists." };

  state.generators.definitions[id] = {
    id,
    name: String(name).trim(),
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
  };
  cachedDefinitions = undefined;
  cachedDefinitionsSource = undefined;
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
  cachedDefinitions = undefined;
  cachedDefinitionsSource = undefined;
  saveGenerators();
  return { ok: true, message: `Added tier ${nextTier}.` };
}

export function updateGeneratorTier(defId: string, tierNumber: number, partial: Partial<Pick<GeneratorTierDefinition, "rateTicks" | "upgradeCost">>): { ok: boolean; message: string } {
  const def = state.generators.definitions[normalizeId(defId)];
  if (!def) return { ok: false, message: "Generator not found." };
  const tier = def.tiers.find((entry) => entry.tier === Math.floor(tierNumber));
  if (!tier) return { ok: false, message: "Tier not found." };

  if (partial.rateTicks !== undefined) tier.rateTicks = Math.max(1, Math.floor(Number(partial.rateTicks)));
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

export function giveGenerator(player: Player, defId: string, amount = 1): { ok: boolean; message: string } {
  const def = state.generators.definitions[normalizeId(defId)];
  if (!def) return { ok: false, message: "Generator not found." };
  const stack = new ItemStack(normalizeItemId(def.baseItemId), Math.max(1, Math.floor(amount)));
  stack.nameTag = def.displayName ?? def.name;
  stack.setLore(buildGeneratorLore(def, 1));
  const placeComp = stack.getComponent("minecraft:can_place_on") as any;
  if (placeComp && def.canPlaceOn && def.canPlaceOn.length > 0) placeComp.blocks = def.canPlaceOn;
  const destroyComp = stack.getComponent("minecraft:can_destroy") as any;
  if (destroyComp && def.canDestroy && def.canDestroy.length > 0) destroyComp.blocks = def.canDestroy;
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return { ok: false, message: "Inventory unavailable." };
   if (!addItemWithoutMergingMetadata(inventory, stack)) return { ok: false, message: "Not enough inventory space." };
  return { ok: true, message: `Gave ${amount}x ${def.name}.` };
}

export function getGeneratorInfoLines(defId: string): string[] {
  const def = getGeneratorDefinition(defId);
  if (!def) return ["Generator not found."];
  const lines: string[] = [];
  const topTier = def.tiers.slice().sort((a, b) => a.tier - b.tier)[0];
  const sortedTiers = def.tiers.slice().sort((a, b) => a.tier - b.tier);
  const highestTier = sortedTiers.length > 0 ? sortedTiers[sortedTiers.length - 1] : undefined;
  lines.push(`Name: ${def.name}`);
  lines.push(`Output: ${def.outputItemId}`);
  lines.push(`Base: ${def.baseItemId}`);
  lines.push(`Place anywhere: ${def.placeAnywhere ? "yes" : "no"}`);
  lines.push(`Tiers: ${def.tiers.length}`);
  if (topTier) lines.push(`Tier 1 speed: ${topTier.rateTicks} ticks`);
  if (highestTier && highestTier !== topTier) lines.push(`Max tier ${highestTier.tier} speed: ${highestTier.rateTicks} ticks`);
  lines.push(`Autobreaker cost: ${getGeneratorAutoBreakerCost(def)}${def.autoBreakerCost !== undefined ? " (custom)" : " (default)"}`);
  return lines;
}

export function getPlacedGeneratorInfoLines(location: Vector3, dimensionId: string): string[] {
  const placed = getPlacedGeneratorAtLocation(location, dimensionId);
  if (!placed) return ["Generator not found."];
  const def = state.generators.definitions[placed.definitionId];
  if (!def) return ["Generator definition missing."];
  const tier = getTier(def, placed.tier);
  const ownerName = getGeneratorOwnerName(placed.ownerPlayerId);
  const lines: string[] = [];
  lines.push(`§6Owner§r: §f${ownerName}`);
  lines.push(`§bTier§r: §f${placed.tier}`);
  lines.push(`§aSpeed§r: §f${tier?.rateTicks ?? 0} ticks`);
  lines.push(`§dProduces§r: §f${def.outputItemId}`);
  lines.push(`§6Autobreaker§r: §f${placed.autoBreakerPurchased ? (placed.autoBreakerEnabled ? "On" : "Off") : "Locked"}${placed.tier >= getMaxTier(def) ? "" : " (locked until max tier)"}`);
  lines.push(`§eNext spawn§r: §f${Math.max(0, Math.ceil((placed.nextSpawnAt - Date.now()) / 50))} ticks`);
  return lines;
}

export function getGeneratorTierSummary(defId: string, tierNumber: number): string | undefined {
  const def = getGeneratorDefinition(defId);
  if (!def) return undefined;
  const tier = def.tiers.find((entry) => entry.tier === tierNumber);
  if (!tier) return undefined;
  return `Tier ${tier.tier}: speed ${tier.rateTicks} ticks, upgrade cost ${tier.upgradeCost}`;
}

export function updateGeneratorConfig(partial: Partial<GeneratorStore["config"]>): { ok: boolean; message: string } {
  if (partial.enabled !== undefined) state.generators.config.enabled = Boolean(partial.enabled);
  if (partial.defaultPlaceAnywhere !== undefined) state.generators.config.defaultPlaceAnywhere = Boolean(partial.defaultPlaceAnywhere);
  if (partial.blockOnPlotOnly !== undefined) state.generators.config.blockOnPlotOnly = Boolean(partial.blockOnPlotOnly);
  if (partial.autoBreakersEnabled !== undefined) state.generators.config.autoBreakersEnabled = Boolean(partial.autoBreakersEnabled);
  saveGenerators();
  return { ok: true, message: "Generator settings updated." };
}

export function placeGenerator(player: Player, location: Vector3, dimensionId: string, itemStack?: ItemStack): { ok: boolean; message: string } {
  if (!state.generators.config.enabled) return { ok: false, message: "Generators are disabled." };
  const loc = blockLocationFromVector(location, dimensionId);
  const existing = getGeneratorAtLocation(loc);
  if (existing) return { ok: false, message: "A generator is already here." };

  const stack = itemStack ?? player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
  if (!stack) return { ok: false, message: "Hold a generator item to place it." };
  const def = getDefinitionByStack(stack);
  if (!def) return { ok: false, message: "That item is not a generator." };
  const outputLoc = { dimensionId: loc.dimensionId, x: loc.x, y: loc.y + 1, z: loc.z };
  if (!isSamePlotFootprint(loc, outputLoc)) return { ok: false, message: "Generators cannot cross plot boundaries." };
  const isAdmin = isOperator(player);
  const plotOwnerId = getPlotOwnerIdForPlayer(player) ?? getPlayerId(player);
  if (!def.placeAnywhere && !isAdmin) {
    const plot = getPlotForLocation(loc);
    if (!plot || plot.occupiedByPlayerId !== plotOwnerId) return { ok: false, message: "This generator can only be placed on your plot." };
  }

  const placed = createPlacedGenerator(def, plotOwnerId, dimensionId, loc, stack);

  if (!spawnGeneratorOutput(loc, def, 1)) {
    return { ok: false, message: "Unable to place generator blocks." };
  }

  if (!consumePlacedGeneratorItem(player, def)) {
    clearGeneratorOutput(loc);
    return { ok: false, message: "Unable to consume generator item." };
  }

  state.generators.placed[placed.id] = placed;
  saveGenerators();
  savePlotAtLocation(loc);
  return { ok: true, message: `Placed ${def.name} block.` };
}

export function pickupGenerator(player: Player, location: Vector3, dimensionId: string): { ok: boolean; message: string } {
  const loc = blockLocationFromVector(location, dimensionId);
  const placed = getGeneratorAtLocation(loc);
  if (!placed) return { ok: false, message: "No generator there." };
  const playerId = getPlayerId(player);
  const team = getPlayerTeam(player);
  const isTeamPlot = team?.teamPlotEnabled ?? false;
  const isOwner = placed.ownerPlayerId === playerId;
  const isTeamMember = isTeamPlot && canAccessTeamPlotGenerator(player, loc);
  if (!isOwner && !isOperator(player) && !isTeamMember) return { ok: false, message: "Only the owner, team members on team plot, or an operator can pick this up." };
  const def = state.generators.definitions[placed.definitionId];
  if (!def) return { ok: false, message: "Generator definition missing." };

  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return { ok: false, message: "Inventory unavailable." };

  const returned = new ItemStack(normalizeItemId(def.baseItemId), 1);
  returned.setLore(buildGeneratorLore(def, placed.tier, placed.autoBreakerPurchased ?? false, placed.autoBreakerEnabled ?? false));
  if (!addItemWithoutMergingMetadata(inventory, returned)) {
    return { ok: false, message: "Inventory full." };
  }

  delete state.generators.placed[placed.id];

  clearGeneratorOutput(loc);
  saveGenerators();
  savePlotAtLocation(loc);
  return { ok: true, message: `Picked up ${def.name}.` };
}

export function handleGeneratorUseOnBlock(player: Player, location: Vector3, dimensionId: string, itemStack?: ItemStack, face?: Direction): { ok: boolean; message: string } {
  const heldStack = player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
  const stack = heldStack ?? itemStack;
  if (!stack) return { ok: false, message: "Hold a generator item to place it." };
  const def = getDefinitionByStack(stack);
  if (!def) return { ok: false, message: "That item is not a generator." };
  const loc = offsetByFace(location, dimensionId, face);
  if (!canPlaceAt(loc, player)) return { ok: false, message: "You cannot place a generator here." };
  return placeGenerator(player, loc, dimensionId, stack);
}

export function pickupGeneratorIfSneaking(player: Player, location: Vector3, dimensionId: string): { ok: boolean; message: string } {
  if (!player.isSneaking) return { ok: false, message: "" };
  const loc = blockLocationFromVector(location, dimensionId);
  const placed = getGeneratorAtLocation(loc) ?? getGeneratorAtLocation({ dimensionId, x: loc.x, y: loc.y - 1, z: loc.z });
  if (!placed) return { ok: false, message: "No generator there." };
  return pickupGenerator(player, { x: placed.x, y: placed.y, z: placed.z }, dimensionId);
}

export function getPlacedGeneratorAtLocation(location: Vector3, dimensionId: string): PlacedGenerator | undefined {
  const loc = blockLocationFromVector(location, dimensionId);
  return getGeneratorAtLocation(loc) ?? getGeneratorAtLocation({ dimensionId, x: loc.x, y: loc.y - 1, z: loc.z });
}

export function getNextUpgradeCost(location: Vector3, dimensionId: string): { cost: number; currency: string; nextTier: number } | undefined {
  const loc = blockLocationFromVector(location, dimensionId);
  const placed = getGeneratorAtLocation(loc);
  if (!placed) return undefined;
  const def = state.generators.definitions[placed.definitionId];
  if (!def) return undefined;
  const nextTier = getTier(def, placed.tier + 1);
  if (!nextTier) return undefined;
  return { cost: nextTier.upgradeCost, currency: state.pay.config.currencyObjective, nextTier: placed.tier + 1 };
}

export function getPlacedGeneratorDefinition(location: Vector3, dimensionId: string): GeneratorDefinition | undefined {
  const placed = getPlacedGeneratorAtLocation(location, dimensionId);
  if (!placed) return undefined;
  return state.generators.definitions[placed.definitionId];
}

export function describeGeneratorStack(itemStack?: ItemStack): string | undefined {
  const def = getDefinitionByStack(itemStack);
  if (!def) return undefined;
  return def.name;
}

export function isGeneratorBlock(location: Vector3, dimensionId: string): boolean {
  const loc = blockLocationFromVector(location, dimensionId);
  return Boolean(getGeneratorAtLocation(loc) || getGeneratorAtLocation({ dimensionId, x: loc.x, y: loc.y - 1, z: loc.z }));
}

export function upgradeGenerator(player: Player, location: Vector3, dimensionId: string): { ok: boolean; message: string } {
  const loc = blockLocationFromVector(location, dimensionId);
  const placed = getGeneratorAtLocation(loc);
  if (!placed) return { ok: false, message: "No generator there." };
  const isOwner = placed.ownerPlayerId === getPlayerId(player);
  const isTeamAccess = canAccessTeamPlotGenerator(player, loc);
  if (!isOwner && !isOperator(player) && !isTeamAccess) return { ok: false, message: "Only the owner, team members on team plot, or an operator can upgrade this generator." };
  const def = state.generators.definitions[placed.definitionId];
  if (!def) return { ok: false, message: "Generator definition missing." };
  const nextUpgrade = getNextUpgradeCost(location, dimensionId);
  const nextTier = nextUpgrade ? getTier(def, nextUpgrade.nextTier) : undefined;
  if (!nextTier) return { ok: false, message: "Generator is already at max tier." };
  const objective = state.pay.config.currencyObjective;
  const balance = getScore(player, objective);
  if (balance === undefined) return { ok: false, message: `Missing scoreboard objective "${objective}".` };
  if (balance < nextTier.upgradeCost) return { ok: false, message: `You need $${nextTier.upgradeCost} to upgrade this generator.` };
  if (!setScore(player, objective, balance - nextTier.upgradeCost)) {
    return { ok: false, message: "Failed to deduct upgrade cost." };
  }

  placed.tier += 1;
  placed.nextSpawnAt = Date.now() + nextTier.rateTicks * 50;
  saveGenerators();
  savePlotAtLocation(loc);
  return { ok: true, message: `Upgraded to tier ${placed.tier} for $${nextTier.upgradeCost}.` };
}

export function toggleGeneratorAutoBreaker(player: Player, location: Vector3, dimensionId: string): { ok: boolean; message: string } {
  const loc = blockLocationFromVector(location, dimensionId);
  const placed = getGeneratorAtLocation(loc);
  if (!placed) return { ok: false, message: "No generator there." };
  const isOwner = placed.ownerPlayerId === getPlayerId(player);
  const isTeamAccess = canAccessTeamPlotGenerator(player, loc);
  if (!isOwner && !isOperator(player) && !isTeamAccess) return { ok: false, message: "Only the owner, team members on team plot, or an operator can change this generator." };
  const def = state.generators.definitions[placed.definitionId];
  if (!def) return { ok: false, message: "Generator definition missing." };
  if (!state.generators.config.autoBreakersEnabled) return { ok: false, message: "Autobreakers are disabled globally." };
  if (placed.tier < getMaxTier(def)) return { ok: false, message: "Autobreaker unlocks at max tier." };

  if (placed.autoBreakerPurchased) {
    placed.autoBreakerEnabled = !placed.autoBreakerEnabled;
    saveGenerators();
    savePlotAtLocation(loc);
    return { ok: true, message: `Autobreaker ${placed.autoBreakerEnabled ? "enabled" : "disabled"}.` };
  }

  const cost = getGeneratorAutoBreakerCost(def);
  const objective = state.pay.config.currencyObjective;
  const balance = getScore(player, objective);
  if (balance === undefined) return { ok: false, message: `Missing scoreboard objective "${objective}".` };
  if (balance < cost) return { ok: false, message: `You need $${cost} to buy autobreaker.` };
  if (!setScore(player, objective, balance - cost)) return { ok: false, message: "Failed to deduct autobreaker cost." };

  placed.autoBreakerPurchased = true;
  placed.autoBreakerEnabled = true;
  saveGenerators();
  savePlotAtLocation(loc);
  return { ok: true, message: `Bought autobreaker for $${cost}.` };
}

export function processGenerators(): void {
  const now = Date.now();
  const onlinePlayers = world.getAllPlayers();
  const onlineIds = new Set<string>();
  const onlinePlayersById = new Map<string, Player>();
  for (const player of onlinePlayers) {
    onlineIds.add(getPlayerId(player));
    onlinePlayersById.set(getPlayerId(player), player);
  }

  for (const placed of Object.values(state.generators.placed)) {
    if (!isGeneratorOwnerActive(placed, onlineIds)) continue;
    const def = state.generators.definitions[placed.definitionId];
    if (!def) continue;
    const tier = getTier(def, placed.tier);
    if (!tier) continue;
    if (now < placed.nextSpawnAt) continue;

    const spawned = spawnGeneratorOutput({ dimensionId: placed.dimensionId, x: placed.x, y: placed.y, z: placed.z }, def, 1);
    if (!spawned) {
      placed.nextSpawnAt = now + Math.max(1, tier.rateTicks) * 50;
      continue;
    }

    if (placed.autoBreakerPurchased && placed.autoBreakerEnabled && isAutoBreakerUnlocked(placed, def)) {
      const owner = onlinePlayersById.get(placed.ownerPlayerId);
      if (owner) {
        collectGeneratorOutput(owner, def, 1);
        clearGeneratorOutput({ dimensionId: placed.dimensionId, x: placed.x, y: placed.y, z: placed.z }, true);
      }
    }

    placed.nextSpawnAt = now + Math.max(0, tier.rateTicks) * 50;
  }
}

export function clearAllGenerators(): void {
  state.generators.placed = {};
  for (const snapshot of Object.values(state.plots.snapshots)) {
    delete snapshot.generators;
  }
  cachedDefinitions = undefined;
  cachedDefinitionsSource = undefined;
  saveGenerators();
}
