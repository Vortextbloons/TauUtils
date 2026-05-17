import { Player, Vector3, system, world } from "@minecraft/server";
import { getPlayerId, getPlayerRank, isFeatureEnabled, isOperator, saveCustomAreas, state, tell } from "../storage";
import { dropCombatInventory } from "../combat";
import { isPlayerInCombat } from "../combat";
import { runBuiltCommandFromConfiguredCommand } from "../command-builder";
import { CUSTOM_AREAS_AREA_PREFIX } from "../storage/state";
import { renderCommandTemplate, renderTemplate } from "../shared/templates";
import type { CustomAreaCommandRule, CustomAreaDefinition } from "../types";

type AreaState = {
  areaIds: Set<string>;
};

type RuntimeArea = {
  area: CustomAreaDefinition;
  allowedRanks: Set<string>;
};

type AreaRuntimeCache = {
  all: RuntimeArea[];
  byDimension: Map<string, RuntimeArea[]>;
};

const playerAreaState = new Map<string, AreaState>();
const lastRuleRunByPlayerArea = new Map<string, number>();
const lastEffectRunByPlayerArea = new Map<string, number>();
const combatDropsByPlayerArea = new Set<string>();
const MAX_SAFE_AREA_COORD = 30000000;
let enabledAreaCache: AreaRuntimeCache | undefined;
let customAreaJobId: number | undefined;

function enabled(): boolean {
  return isFeatureEnabled("customAreas") && state.customAreas.config.enabled;
}

function normalizedRankSet(area: CustomAreaDefinition): Set<string> {
  return new Set(area.allowedRanks.map((rank) => rank.trim().toLowerCase()).filter((rank) => rank.length > 0));
}

function playerAllowedByRank(player: Player, runtime: RuntimeArea): boolean {
  const ranks = runtime.allowedRanks;
  if (ranks.size === 0) return true;
  const rank = getPlayerRank(player.name);
  return Boolean(rank && ranks.has(rank.id.toLowerCase()));
}

function pointInside(area: CustomAreaDefinition, location: Vector3, dimensionId: string): boolean {
  return area.enabled && area.dimensionId === dimensionId &&
    location.x >= area.min.x && location.x <= area.max.x &&
    location.y >= area.min.y && location.y <= area.max.y &&
    location.z >= area.min.z && location.z <= area.max.z;
}

function getEnabledAreaCache(): AreaRuntimeCache {
  if (!enabledAreaCache) {
    const all = Object.values(state.customAreas.areas)
      .filter((area) => area.enabled)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .map((area) => ({ area, allowedRanks: normalizedRankSet(area) }));
    const byDimension = new Map<string, RuntimeArea[]>();
    for (const runtime of all) {
      const areas = byDimension.get(runtime.area.dimensionId) ?? [];
      areas.push(runtime);
      byDimension.set(runtime.area.dimensionId, areas);
    }
    enabledAreaCache = { all, byDimension };
  }
  return enabledAreaCache;
}

function getEnabledAreaRuntime(dimensionId?: string): RuntimeArea[] {
  if (!enabled()) return [];
  const cache = getEnabledAreaCache();
  return dimensionId ? (cache.byDimension.get(dimensionId) ?? []) : cache.all;
}

export function getAreasForLocation(location: Vector3, dimensionId: string): CustomAreaDefinition[] {
  return getEnabledAreaRuntime(dimensionId)
    .filter((runtime) => pointInside(runtime.area, location, dimensionId))
    .map((runtime) => runtime.area);
}

function getAreaForPlayer(player: Player, location: Vector3 = player.location, dimensionId: string = player.dimension.id): CustomAreaDefinition | undefined {
  return getEnabledAreaRuntime(dimensionId).find((runtime) => pointInside(runtime.area, location, dimensionId) && playerAllowedByRank(player, runtime))?.area;
}

function formatAreaMessage(raw: string, player: Player, area: CustomAreaDefinition): string {
  return renderTemplate(raw, {
    player,
    extra: {
      area: area.name,
      area_id: area.id,
      x: Math.floor(player.location.x),
      y: Math.floor(player.location.y),
      z: Math.floor(player.location.z),
      dimension: player.dimension.id,
    },
  });
}

function sendAreaMessage(player: Player, area: CustomAreaDefinition, raw?: string): void {
  if (!raw) return;
  const message = formatAreaMessage(raw, player, area);
  if (area.broadcastMessages) world.sendMessage(message);
  else tell(player, message);
}

function runCommandRule(player: Player, area: CustomAreaDefinition, rule: CustomAreaCommandRule): void {
  if (!rule.enabled) return;
  for (const raw of rule.commands.slice(0, state.customAreas.config.maxCommandsPerArea)) {
    const command = renderCommandTemplate(raw, {
      player,
      extra: {
        area: area.name,
        area_id: area.id,
        x: Math.floor(player.location.x),
        y: Math.floor(player.location.y),
        z: Math.floor(player.location.z),
        dimension: player.dimension.id,
      },
    });
    if (!command) continue;
    if (runBuiltCommandFromConfiguredCommand(player, command)) continue;
    try {
      player.runCommand(command);
    } catch {
    }
  }
}

function runEnter(area: CustomAreaDefinition, player: Player): void {
  sendAreaMessage(player, area, area.enterMessage);
  for (const rule of area.commandRules) if (rule.runOnEnter) runCommandRule(player, area, rule);
}

function runLeave(area: CustomAreaDefinition, player: Player): void {
  sendAreaMessage(player, area, area.leaveMessage);
  for (const rule of area.commandRules) if (rule.runOnLeave) runCommandRule(player, area, rule);
}

function maybeDropCombatInventory(player: Player, area: CustomAreaDefinition): void {
  if (!area.dropItemsIfInCombat) return;
  if (isOperator(player)) return;
  const key = `${getPlayerId(player)}:${area.id}`;
  if (!isPlayerInCombat(player)) {
    combatDropsByPlayerArea.delete(key);
    return;
  }
  if (combatDropsByPlayerArea.has(key)) return;
  combatDropsByPlayerArea.add(key);
  const direction = player.getViewDirection();
  const dropLocation = {
    x: player.location.x - direction.x * 2,
    y: player.location.y,
    z: player.location.z - direction.z * 2,
  };
  if (dropCombatInventory(player, dropLocation)) tell(player, "§cYou entered a restricted combat area and dropped your items.");
}

export function processCustomAreas(): void {
  if (!enabled()) return;
  const allAreas = getEnabledAreaRuntime();
  if (allAreas.length === 0) return;
  if (customAreaJobId !== undefined) return;
  customAreaJobId = system.runJob(processCustomAreasJob());
}

function* processCustomAreasJob(): Generator<void, void, void> {
  if (!enabled()) {
    customAreaJobId = undefined;
    return;
  }
  const now = Date.now();
  for (const player of world.getAllPlayers()) {
    if (!enabled()) break;
    const playerId = getPlayerId(player);
    const location = player.location;
    const dimensionId = player.dimension.id;
    const previous = playerAreaState.get(playerId)?.areaIds ?? new Set<string>();
    const current = new Set<string>();
    for (const runtime of getEnabledAreaRuntime(dimensionId)) {
      const area = runtime.area;
      if (!pointInside(area, location, dimensionId)) continue;
      if (!playerAllowedByRank(player, runtime)) continue;
      current.add(area.id);
      if (!previous.has(area.id)) runEnter(area, player);
      maybeDropCombatInventory(player, area);
      for (let index = 0; index < area.effects.length; index++) {
        const effect = area.effects[index];
        if (!effect.enabled) continue;
        const key = `${playerId}:${area.id}:effect:${index}`;
        const intervalMs = Math.max(1, effect.intervalTicks) * 50;
        if (now - (lastEffectRunByPlayerArea.get(key) ?? 0) < intervalMs) continue;
        lastEffectRunByPlayerArea.set(key, now);
        try {
          player.runCommand(`effect @s ${effect.effectId} ${Math.max(1, Math.floor(effect.durationSeconds))} ${Math.max(0, Math.floor(effect.amplifier))} ${effect.hideParticles ? "true" : "false"}`);
        } catch {
        }
      }
      for (let index = 0; index < area.commandRules.length; index++) {
        const rule = area.commandRules[index];
        if (!rule.enabled || !rule.runWhileInside) continue;
        const key = `${playerId}:${area.id}:cmd:${index}`;
        const intervalMs = Math.max(1, rule.intervalTicks) * 50;
        if (now - (lastRuleRunByPlayerArea.get(key) ?? 0) < intervalMs) continue;
        lastRuleRunByPlayerArea.set(key, now);
        runCommandRule(player, area, rule);
      }
    }
    for (const oldId of previous) {
      if (current.has(oldId)) continue;
      combatDropsByPlayerArea.delete(`${playerId}:${oldId}`);
      const area = state.customAreas.areas[oldId];
      if (area) runLeave(area, player);
    }
    playerAreaState.set(playerId, { areaIds: current });
    yield;
  }
  customAreaJobId = undefined;
}

export function shouldCancelAreaBlockBreak(player: Player, location: Vector3, dimensionId: string): boolean {
  if (isOperator(player)) return false;
  const area = getAreaForPlayer(player, location, dimensionId);
  return Boolean(area && !area.permissions.blockBreak);
}

export function shouldCancelAreaBlockPlace(player: Player, location: Vector3, dimensionId: string): boolean {
  if (isOperator(player)) return false;
  const area = getAreaForPlayer(player, location, dimensionId);
  return Boolean(area && !area.permissions.blockPlace);
}

export function shouldCancelAreaItemUse(player: Player): boolean {
  if (isOperator(player)) return false;
  const area = getAreaForPlayer(player);
  return Boolean(area && !area.permissions.itemUse);
}

export function shouldCancelAreaEntityInteract(player: Player): boolean {
  if (isOperator(player)) return false;
  const area = getAreaForPlayer(player);
  return Boolean(area && !area.permissions.entityInteract);
}

export function shouldCancelAreaPvp(victim: Player, attacker: Player): boolean {
  if (isOperator(victim) || isOperator(attacker)) return false;
  const victimArea = getAreaForPlayer(victim);
  if (victimArea) return !victimArea.permissions.pvp;
  const attackerArea = getAreaForPlayer(attacker);
  return Boolean(attackerArea && !attackerArea.permissions.pvp);
}

export function normalizeAreaBounds(a: Vector3, b: Vector3): { min: Vector3; max: Vector3 } {
  return {
    min: { x: Math.min(Math.floor(a.x), Math.floor(b.x)), y: Math.min(Math.floor(a.y), Math.floor(b.y)), z: Math.min(Math.floor(a.z), Math.floor(b.z)) },
    max: { x: Math.max(Math.floor(a.x), Math.floor(b.x)), y: Math.max(Math.floor(a.y), Math.floor(b.y)), z: Math.max(Math.floor(a.z), Math.floor(b.z)) },
  };
}

function coordsText(area: CustomAreaDefinition): string {
  return `${area.min.x} ${area.min.y} ${area.min.z} ${area.max.x} ${area.max.y} ${area.max.z}`;
}

function safeAreaVector(vector: Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z) &&
    Math.abs(vector.x) <= MAX_SAFE_AREA_COORD && Math.abs(vector.y) <= MAX_SAFE_AREA_COORD && Math.abs(vector.z) <= MAX_SAFE_AREA_COORD;
}

function normalizeAreaDefinition(area: CustomAreaDefinition): CustomAreaDefinition {
  const bounds = normalizeAreaBounds(area.min, area.max);
  return {
    ...area,
    dimensionId: String(area.dimensionId ?? "minecraft:overworld").trim() || "minecraft:overworld",
    min: bounds.min,
    max: bounds.max,
    allowedRanks: [...(area.allowedRanks ?? [])],
    permissions: Object.assign({ pvp: true, blockBreak: true, blockPlace: true, itemUse: true, entityInteract: true }, area.permissions ?? {}),
    dropItemsIfInCombat: area.dropItemsIfInCombat ?? false,
    commandRules: (area.commandRules ?? []).map((rule) => ({ ...rule, commands: [...(rule.commands ?? [])] })),
    effects: (area.effects ?? []).map((effect) => ({ ...effect })),
    tickingArea: area.tickingArea ? { ...area.tickingArea } : undefined,
  };
}

export function invalidateCustomAreaRuntimeState(areaId?: string): void {
  enabledAreaCache = undefined;
  playerAreaState.clear();
  if (!areaId) {
    lastRuleRunByPlayerArea.clear();
    lastEffectRunByPlayerArea.clear();
    combatDropsByPlayerArea.clear();
    return;
  }
  const marker = `:${areaId}:`;
  for (const key of lastRuleRunByPlayerArea.keys()) if (key.includes(marker)) lastRuleRunByPlayerArea.delete(key);
  for (const key of lastEffectRunByPlayerArea.keys()) if (key.includes(marker)) lastEffectRunByPlayerArea.delete(key);
  for (const key of combatDropsByPlayerArea) if (key.endsWith(marker.slice(0, -1))) combatDropsByPlayerArea.delete(key);
}

export function commitCustomArea(area: CustomAreaDefinition): { ok: boolean; message: string; area?: CustomAreaDefinition } {
  if (!area.id) return { ok: false, message: "Area ID is missing." };
  if (!safeAreaVector(area.min) || !safeAreaVector(area.max)) {
    return { ok: false, message: `Coordinates must be finite and within +/-${MAX_SAFE_AREA_COORD}.` };
  }

  const hadPrevious = Object.prototype.hasOwnProperty.call(state.customAreas.areas, area.id);
  const previous = state.customAreas.areas[area.id];
  const rollback = (message: string): { ok: boolean; message: string } => {
    if (hadPrevious && previous) state.customAreas.areas[area.id] = previous;
    else delete state.customAreas.areas[area.id];
    saveCustomAreas();
    invalidateCustomAreaRuntimeState(area.id);
    return { ok: false, message };
  };

  const next = normalizeAreaDefinition(area);
  state.customAreas.areas[next.id] = next;
  if (!saveCustomAreas()) return rollback("Dynamic property save failed. Changes were reverted. Reduce area data size and retry.");

  const raw = world.getDynamicProperty(`${CUSTOM_AREAS_AREA_PREFIX}${next.id}`) as string | undefined;
  let persisted: CustomAreaDefinition | undefined;
  try {
    persisted = raw ? JSON.parse(raw) as CustomAreaDefinition : undefined;
  } catch {
    persisted = undefined;
  }

  if (!persisted || persisted.id !== next.id || persisted.dimensionId !== next.dimensionId || coordsText(persisted) !== coordsText(next)) {
    return rollback(`Save verification failed and changes were reverted. Expected ${next.dimensionId} ${coordsText(next)}, persisted ${persisted ? `${persisted.dimensionId} ${coordsText(persisted)}` : "nothing"}.`);
  }

  invalidateCustomAreaRuntimeState(next.id);
  return { ok: true, message: `Saved area ${next.id}: ${next.dimensionId} ${coordsText(next)}`, area: next };
}

export function applyAreaTickingArea(area: CustomAreaDefinition): { ok: boolean; message: string } {
  if (!area.tickingArea?.enabled) return { ok: false, message: "Ticking area is disabled for this area." };
  const name = area.tickingArea.name.trim() || area.id;
  try {
    world.getDimension(area.dimensionId).runCommand(`tickingarea add ${area.min.x} ${area.min.y} ${area.min.z} ${area.max.x} ${area.max.y} ${area.max.z} ${name}`);
    return { ok: true, message: `Applied ticking area ${name}.` };
  } catch {
    return { ok: false, message: "Failed to apply ticking area." };
  }
}

export function saveAreaStore(): void {
  saveCustomAreas();
}
