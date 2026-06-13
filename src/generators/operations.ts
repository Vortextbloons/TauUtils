import { BlockPermutation, Direction, ItemStack, Player, Vector3, system, world } from "@minecraft/server";
import { getPlayerId, getScore, isFeatureEnabled, isOperator, saveGenerators, setScore, state } from "../storage";
import { getPlayerTeam } from "../teams";
import { getPlotForLocation, getPlotOwnerIdForPlayer, savePlotAtLocation } from "../plots";
import { getItemCanDestroyComponent, getItemCanPlaceOnComponent } from "../shared/item-components";
import type { GeneratorDefinition, GeneratorTierDefinition, GeneratorStore, PlacedGenerator } from "../types/game";
import { GENERATOR_MARKER_PREFIX, GENERATOR_TIER_PREFIX, type GeneratorLocation } from "./types";
import { clearGeneratorOutput, getDefinitionByStack, getGeneratorAutoBreakerCost, getMaxTier, getTier, isGeneratorAdminProtected, normalizeId, normalizeItemId, readGeneratorItemData, restoreGeneratorBlocks } from "./definitions";
import { getGeneratorOutputFallback, getGeneratorProducesSummary, pickGeneratorOutput } from "./output-pick";

const TURBO_BURST_PER_VISIT = 8;

let generatorProcessCursor = 0;
let generatorProcessJobId: number | undefined;

type GeneratorIndexes = {
  dueSorted: PlacedGenerator[];
  earliestDueAt: number;
};

let generatorIndexes: GeneratorIndexes | undefined;
let generatorIndexesDirty = true;

function markGeneratorIndexesDirty(): void {
  generatorIndexesDirty = true;
}

function buildGeneratorIndexes(): GeneratorIndexes {
  const dueSorted = Object.values(state.generators.placed).slice().sort((a, b) => a.nextSpawnAt - b.nextSpawnAt || a.id.localeCompare(b.id));
  const earliestDueAt = dueSorted[0]?.nextSpawnAt ?? Number.POSITIVE_INFINITY;
  return { dueSorted, earliestDueAt };
}

function getGeneratorIndexes(): GeneratorIndexes {
  if (!generatorIndexes || generatorIndexesDirty) {
    generatorIndexes = buildGeneratorIndexes();
    generatorIndexesDirty = false;
  }
  return generatorIndexes;
}

function stripFormatting(value: string): string {
  return String(value ?? "").replace(/§./g, "").trim();
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

function getGeneratorOwnerName(ownerPlayerId: string): string {
  return Object.entries(state.stats.playerIds).find(([, id]) => id === ownerPlayerId)?.[0] ?? ownerPlayerId;
}

function canAccessTeamPlotGenerator(player: Player, location: GeneratorLocation): boolean {
  const team = getPlayerTeam(player);
  if (!team?.teamPlotEnabled) return false;
  const plot = getPlotForLocation(location);
  if (!plot || plot.occupiedByPlayerId !== team.ownerPlayerId) return false;

  const playerId = getPlayerId(player);
  return playerId === team.ownerPlayerId || team.memberPlayerIds.includes(playerId);
}

function isGeneratorOwnerActive(placed: PlacedGenerator, onlineIds: Set<string>, activeTeamOwnerIds: Set<string>): boolean {
  if (onlineIds.has(placed.ownerPlayerId)) return true;
  return activeTeamOwnerIds.has(placed.ownerPlayerId);
}

export function canPlayerManagePlacedGenerator(player: Player, definition: GeneratorDefinition): boolean {
  if (!isGeneratorAdminProtected(definition)) return true;
  return isOperator(player);
}

export function canPlayerPlaceGeneratorDefinition(player: Player, definition: GeneratorDefinition): boolean {
  if (!isGeneratorAdminProtected(definition)) return true;
  return isOperator(player);
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
    nextSpawnAt: scheduleInitialSpawnAt(tierEntry?.rateTicks ?? 100),
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
  if (def.adminProtected) lore.push(`§6Admin generator§r: §fprotected`);
  lore.push(`${GENERATOR_MARKER_PREFIX}${def.id}:${tier}:${autoBreakerPurchased ? 1 : 0}:${autoBreakerEnabled ? 1 : 0}]`);
  return lore;
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

function blockLocationFromVector(location: Vector3, dimensionId: string): GeneratorLocation {
  return {
    dimensionId,
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}

function getGeneratorAtLocation(location: GeneratorLocation): PlacedGenerator | undefined {
  return state.generators.placed[locationKey(location)];
}

function getGeneratorAtLocationKey(key: string): PlacedGenerator | undefined {
  return state.generators.placed[key];
}

function canPlaceAt(location: GeneratorLocation, player?: Player): boolean {
  if (state.generators.config.blockOnPlotOnly && !(player && isOperator(player))) {
    if (!getPlotForLocation(location)) return false;
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

function getTopBlock(location: GeneratorLocation) {
  try {
    return world.getDimension(location.dimensionId).getBlock({ x: location.x, y: location.y + 1, z: location.z });
  } catch {
    return undefined;
  }
}

function isGeneratorOutputSlotEmpty(location: GeneratorLocation): boolean {
  const outputBlock = getTopBlock(location);
  if (!outputBlock) return false;
  return outputBlock.typeId === "minecraft:air";
}

function scheduleInitialSpawnAt(rateTicks: number): number {
  const now = Date.now();
  if (rateTicks <= 0) return now;
  return now + rateTicks * 50;
}

function scheduleNextSpawnAt(rateTicks: number, now: number, spawned: boolean): number {
  if (rateTicks <= 0) return now;
  if (!spawned) return now + Math.max(1, rateTicks) * 50;
  return now + rateTicks * 50;
}

function spawnGeneratorOutput(location: GeneratorLocation, outputItemId: string): boolean {
  try {
    const dim = world.getDimension(location.dimensionId);
    const baseBlock = dim.getBlock({ x: location.x, y: location.y, z: location.z });
    const outputBlock = dim.getBlock({ x: location.x, y: location.y + 1, z: location.z });
    if (!baseBlock || !outputBlock) return false;
    baseBlock.setPermutation(BlockPermutation.resolve("minecraft:bedrock"));
    outputBlock.setPermutation(BlockPermutation.resolve(normalizeItemId(outputItemId)));
    return true;
  } catch {
    return false;
  }
}

function captureOriginalGeneratorBlocks(location: GeneratorLocation): Pick<PlacedGenerator, "originalBaseBlockId" | "originalOutputBlockId"> {
  try {
    const dim = world.getDimension(location.dimensionId);
    const base = dim.getBlock({ x: location.x, y: location.y, z: location.z });
    const output = dim.getBlock({ x: location.x, y: location.y + 1, z: location.z });
    return {
      originalBaseBlockId: base?.typeId,
      originalOutputBlockId: output?.typeId,
    };
  } catch {
    return {};
  }
}

function collectGeneratorOutput(player: Player, outputItemId: string, amount: number): void {
  try {
    const stack = new ItemStack(normalizeItemId(outputItemId), Math.max(1, Math.floor(amount)));
    const inventory = player.getComponent("minecraft:inventory")?.container;
    if (!inventory) {
      player.dimension.spawnItem(stack, player.location);
      return;
    }
    const leftover = inventory.addItem(stack);
    if (leftover) player.dimension.spawnItem(leftover, player.location);
  } catch {
  }
}

export function giveGenerator(player: Player, defId: string, amount = 1): { ok: boolean; message: string } {
  const def = state.generators.definitions[normalizeId(defId)];
  if (!def) return { ok: false, message: "Generator not found." };
  const stack = new ItemStack(normalizeItemId(def.baseItemId), Math.max(1, Math.floor(amount)));
  stack.nameTag = def.displayName ?? def.name;
  stack.setLore(buildGeneratorLore(def, 1));
  const placeComp = getItemCanPlaceOnComponent(stack);
  if (placeComp && def.canPlaceOn && def.canPlaceOn.length > 0) placeComp.blocks = def.canPlaceOn;
  const destroyComp = getItemCanDestroyComponent(stack);
  if (destroyComp && def.canDestroy && def.canDestroy.length > 0) destroyComp.blocks = def.canDestroy;
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return { ok: false, message: "Inventory unavailable." };
  if (!addItemWithoutMergingMetadata(inventory, stack)) return { ok: false, message: "Not enough inventory space." };
  return { ok: true, message: `Gave ${amount}x ${def.name}.` };
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
  lines.push(`§dProduces§r: §f${getGeneratorProducesSummary(def)}`);
  if (tier?.rateTicks === 0) lines.push(`§cTurbo§r: §fmax speed`);
  lines.push(`§6Autobreaker§r: §f${placed.autoBreakerPurchased ? (placed.autoBreakerEnabled ? "On" : "Off") : "Locked"}${placed.tier >= getMaxTier(def) ? "" : " (locked until max tier)"}`);
  const outputLoc: GeneratorLocation = { dimensionId, x: placed.x, y: placed.y, z: placed.z };
  const hasOutput = !isGeneratorOutputSlotEmpty(outputLoc);
  lines.push(hasOutput ? `§eOutput§r: §fready (break to refill)` : `§eNext spawn§r: §f${Math.max(0, Math.ceil((placed.nextSpawnAt - Date.now()) / 50))} ticks`);
  if (def.adminProtected) lines.push(`§6Admin generator§r: §fview only (operators manage)`);
  return lines;
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
  if (!canPlayerPlaceGeneratorDefinition(player, def)) {
    return { ok: false, message: "Only operators can place admin generators." };
  }
  const outputLoc = { dimensionId: loc.dimensionId, x: loc.x, y: loc.y + 1, z: loc.z };
  if (!isSamePlotFootprint(loc, outputLoc)) return { ok: false, message: "Generators cannot cross plot boundaries." };
  if (!isGeneratorOutputSlotEmpty(loc)) return { ok: false, message: "The block above the generator must be empty." };
  const isAdmin = isOperator(player);
  const plotOwnerId = getPlotOwnerIdForPlayer(player) ?? getPlayerId(player);
  if (!def.placeAnywhere && !isAdmin) {
    const plot = getPlotForLocation(loc);
    if (!plot || plot.occupiedByPlayerId !== plotOwnerId) return { ok: false, message: "This generator can only be placed on your plot." };
  }

  const placed = { ...createPlacedGenerator(def, plotOwnerId, dimensionId, loc, stack), ...captureOriginalGeneratorBlocks(loc) };

  const initialOutput = pickGeneratorOutput(def) ?? getGeneratorOutputFallback(def);
  if (!spawnGeneratorOutput(loc, initialOutput)) {
    return { ok: false, message: "Unable to place generator blocks." };
  }

  if (!consumePlacedGeneratorItem(player, def)) {
    restoreGeneratorBlocks(placed);
    return { ok: false, message: "Unable to consume generator item." };
  }

  state.generators.placed[placed.id] = placed;
  markGeneratorIndexesDirty();
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
  if (!canPlayerManagePlacedGenerator(player, def)) {
    return { ok: false, message: "This admin generator cannot be picked up." };
  }

  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return { ok: false, message: "Inventory unavailable." };

  const returned = new ItemStack(normalizeItemId(def.baseItemId), 1);
  returned.setLore(buildGeneratorLore(def, placed.tier, placed.autoBreakerPurchased ?? false, placed.autoBreakerEnabled ?? false));
  if (!addItemWithoutMergingMetadata(inventory, returned)) {
    return { ok: false, message: "Inventory full." };
  }

  delete state.generators.placed[placed.id];
  markGeneratorIndexesDirty();

  restoreGeneratorBlocks(placed);
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
  if (!canPlayerPlaceGeneratorDefinition(player, def)) {
    return { ok: false, message: "Only operators can place admin generators." };
  }
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
  if (!canPlayerManagePlacedGenerator(player, def)) {
    return { ok: false, message: "This admin generator cannot be upgraded." };
  }
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
  placed.nextSpawnAt = scheduleInitialSpawnAt(nextTier.rateTicks);
  markGeneratorIndexesDirty();
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
  if (!canPlayerManagePlacedGenerator(player, def)) {
    return { ok: false, message: "This admin generator cannot be changed." };
  }
  if (!state.generators.config.autoBreakersEnabled) return { ok: false, message: "Autobreakers are disabled globally." };
  if (placed.tier < getMaxTier(def)) return { ok: false, message: "Autobreaker unlocks at max tier." };

  if (placed.autoBreakerPurchased) {
    placed.autoBreakerEnabled = !placed.autoBreakerEnabled;
    markGeneratorIndexesDirty();
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
  markGeneratorIndexesDirty();
  saveGenerators();
  savePlotAtLocation(loc);
  return { ok: true, message: `Bought autobreaker for $${cost}.` };
}

export function processGenerators(): void {
  if (!isFeatureEnabled("generators")) return;
  const now = Date.now();
  const indexes = getGeneratorIndexes();
  if (indexes.dueSorted.length === 0) {
    generatorProcessCursor = 0;
    return;
  }
  if (now < indexes.earliestDueAt) return;
  if (generatorProcessJobId !== undefined) return;

  generatorProcessJobId = system.runJob(processGeneratorsJob(now, indexes));
}

function runGeneratorSpawnCycle(
  placed: PlacedGenerator,
  def: GeneratorDefinition,
  tier: GeneratorTierDefinition,
  now: number,
  onlinePlayersById: Map<string, Player>
): boolean {
  const location: GeneratorLocation = { dimensionId: placed.dimensionId, x: placed.x, y: placed.y, z: placed.z };
  const outputBlock = getTopBlock(location);

  if (outputBlock && !isGeneratorOutputSlotEmpty(location)) {
    if (placed.autoBreakerPurchased && placed.autoBreakerEnabled && isAutoBreakerUnlocked(placed, def)) {
      const owner = onlinePlayersById.get(placed.ownerPlayerId);
      if (owner) {
        collectGeneratorOutput(owner, outputBlock.typeId, 1);
        clearGeneratorOutput(location, true);
        placed.nextSpawnAt = scheduleNextSpawnAt(tier.rateTicks, now, true);
        return true;
      }
    }
    placed.nextSpawnAt = scheduleNextSpawnAt(tier.rateTicks, now, false);
    return false;
  }

  const outputId = pickGeneratorOutput(def) ?? getGeneratorOutputFallback(def);
  const spawned = spawnGeneratorOutput(location, outputId);
  if (!spawned) {
    placed.nextSpawnAt = scheduleNextSpawnAt(tier.rateTicks, now, false);
    return false;
  }

  if (placed.autoBreakerPurchased && placed.autoBreakerEnabled && isAutoBreakerUnlocked(placed, def)) {
    const owner = onlinePlayersById.get(placed.ownerPlayerId);
    if (owner) {
      collectGeneratorOutput(owner, outputId, 1);
      clearGeneratorOutput(location, true);
    }
  }

  placed.nextSpawnAt = scheduleNextSpawnAt(tier.rateTicks, now, true);
  return true;
}

function* processGeneratorsJob(now: number, indexes: GeneratorIndexes): Generator<void, void, void> {
  if (!isFeatureEnabled("generators")) {
    generatorProcessJobId = undefined;
    return;
  }
  const onlinePlayers = world.getAllPlayers();
  if (onlinePlayers.length === 0) {
    generatorProcessJobId = undefined;
    return;
  }
  const onlineIds = new Set<string>();
  const onlinePlayersById = new Map<string, Player>();
  for (const player of onlinePlayers) {
    const playerId = getPlayerId(player);
    onlineIds.add(playerId);
    onlinePlayersById.set(playerId, player);
  }

  const activeTeamOwnerIds = new Set<string>();
  for (const team of Object.values(state.teams.teams)) {
    if (!team.teamPlotEnabled) continue;
    if (onlineIds.has(team.ownerPlayerId) || team.memberPlayerIds.some((memberId) => onlineIds.has(memberId))) {
      activeTeamOwnerIds.add(team.ownerPlayerId);
    }
  }

  const placedGenerators = indexes.dueSorted;
  const maxTurboSpawns = Math.max(1, Math.floor(state.generators.config.maxTurboSpawnsPerCycle ?? 32));

  let changedSchedule = false;
  let turboSpawnsThisCycle = 0;
  let turboCursor = generatorProcessCursor;

  for (let turboIndex = 0; turboIndex < placedGenerators.length && turboSpawnsThisCycle < maxTurboSpawns; turboIndex++) {
    if (!isFeatureEnabled("generators")) break;
    const placed = placedGenerators[turboCursor % placedGenerators.length];
    turboCursor = (turboCursor + 1) % Math.max(1, placedGenerators.length);
    if (!placed) {
      yield;
      continue;
    }
    if (!isGeneratorOwnerActive(placed, onlineIds, activeTeamOwnerIds)) {
      yield;
      continue;
    }
    const def = state.generators.definitions[placed.definitionId];
    if (!def) {
      yield;
      continue;
    }
    const tier = getTier(def, placed.tier);
    if (!tier || tier.rateTicks !== 0) {
      yield;
      continue;
    }
    if (now < placed.nextSpawnAt) {
      yield;
      continue;
    }

    let burstCount = 0;
    while (burstCount < TURBO_BURST_PER_VISIT && turboSpawnsThisCycle < maxTurboSpawns) {
      if (!isFeatureEnabled("generators")) break;
      if (now < placed.nextSpawnAt) break;
      const spawned = runGeneratorSpawnCycle(placed, def, tier, now, onlinePlayersById);
      changedSchedule = true;
      turboSpawnsThisCycle += 1;
      burstCount += 1;
      yield;
      if (!spawned) break;
    }
  }

  const processBudget = Math.min(placedGenerators.length, Math.max(64, onlinePlayers.length * 16));
  for (let index = 0; index < processBudget; index++) {
    if (!isFeatureEnabled("generators")) break;
    const placed = placedGenerators[generatorProcessCursor % placedGenerators.length];
    generatorProcessCursor = (generatorProcessCursor + 1) % placedGenerators.length;
    if (!placed) {
      yield;
      continue;
    }
    if (!isGeneratorOwnerActive(placed, onlineIds, activeTeamOwnerIds)) {
      yield;
      continue;
    }
    const def = state.generators.definitions[placed.definitionId];
    if (!def) {
      yield;
      continue;
    }
    const tier = getTier(def, placed.tier);
    if (!tier) {
      yield;
      continue;
    }
    if (tier.rateTicks === 0) {
      yield;
      continue;
    }
    if (now < placed.nextSpawnAt) {
      yield;
      continue;
    }

    runGeneratorSpawnCycle(placed, def, tier, now, onlinePlayersById);
    changedSchedule = true;
    yield;
  }
  if (changedSchedule) markGeneratorIndexesDirty();
  generatorProcessJobId = undefined;
}
