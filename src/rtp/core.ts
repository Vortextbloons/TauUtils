import { EntityDamageCause, Player, Vector3, world } from "@minecraft/server";
import { getCustomAreaAtLocation } from "../custom-areas";
import { getClaimAt } from "../claims";
import { isPlayerInCombat } from "../combat";
import { getPlayerId, getPlayerRank, isFeatureEnabled, saveRtp, state } from "../storage";
import type { RtpProtection, RtpRegion } from "../types";

type ProtectedState = {
  until: number;
  protection: RtpProtection;
};

const cooldownByPlayerId = new Map<string, number>();
const protectedByPlayerId = new Map<string, ProtectedState>();

const UNSAFE_BELOW = new Set(["minecraft:lava", "minecraft:flowing_lava", "minecraft:fire", "minecraft:soul_fire", "minecraft:cactus", "minecraft:magma", "minecraft:powder_snow"]);

function enabled(): boolean {
  return isFeatureEnabled("rtp") && state.rtp.config.enabled;
}

function normalizeBounds(a: Vector3, b: Vector3): { min: Vector3; max: Vector3 } {
  return {
    min: { x: Math.min(Math.floor(a.x), Math.floor(b.x)), y: -64, z: Math.min(Math.floor(a.z), Math.floor(b.z)) },
    max: { x: Math.max(Math.floor(a.x), Math.floor(b.x)), y: 320, z: Math.max(Math.floor(a.z), Math.floor(b.z)) },
  };
}

export function normalizeRtpBounds(a: Vector3, b: Vector3): { min: Vector3; max: Vector3 } {
  return normalizeBounds(a, b);
}

export function listRtpRegions(player?: Player): RtpRegion[] {
  return Object.values(state.rtp.regions)
    .filter((region) => region.enabled && (!player || playerAllowed(player, region)))
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

function playerAllowed(player: Player, region: RtpRegion): boolean {
  if (region.allowedRanks.length === 0) return true;
  const rank = getPlayerRank(player.name);
  return Boolean(rank && region.allowedRanks.map((entry) => entry.toLowerCase()).includes(rank.id.toLowerCase()));
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function isAirLike(typeId: string): boolean {
  return typeId === "minecraft:air" || typeId === "minecraft:cave_air" || typeId === "minecraft:void_air";
}

function isUnsafeBelow(typeId: string): boolean {
  return isAirLike(typeId) || UNSAFE_BELOW.has(typeId) || typeId.includes("water") || typeId.includes("lava");
}

function safeLocation(region: RtpRegion, x: number, z: number): Vector3 | undefined {
  const dimension = world.getDimension(region.dimensionId);
  for (let y = 318; y >= -63; y--) {
    const below = dimension.getBlock({ x, y: y - 1, z });
    const feet = dimension.getBlock({ x, y, z });
    const head = dimension.getBlock({ x, y: y + 1, z });
    if (!below || !feet || !head) continue;
    if (isUnsafeBelow(below.typeId)) continue;
    if (!isAirLike(feet.typeId) || !isAirLike(head.typeId)) continue;
    const loc = { x: x + 0.5, y, z: z + 0.5 };
    if (region.avoidClaims && getClaimAt(loc, region.dimensionId)) continue;
    if (region.avoidCustomAreas && getCustomAreaAtLocation(loc, region.dimensionId)) continue;
    return loc;
  }
  return undefined;
}

function findRandomLocation(region: RtpRegion): Vector3 | undefined {
  const bounds = normalizeBounds(region.min, region.max);
  const attempts = Math.max(1, region.maxAttempts || state.rtp.config.maxAttempts);
  let fallbackSkyLocation: Vector3 | undefined;
  for (let i = 0; i < attempts; i++) {
    const x = randomInt(bounds.min.x, bounds.max.x);
    const z = randomInt(bounds.min.z, bounds.max.z);
    const skyLocation = { x: x + 0.5, y: 319, z: z + 0.5 };
    if (!fallbackSkyLocation) {
      const blockedByClaim = region.avoidClaims && getClaimAt(skyLocation, region.dimensionId);
      const blockedByArea = region.avoidCustomAreas && getCustomAreaAtLocation(skyLocation, region.dimensionId);
      if (!blockedByClaim && !blockedByArea) fallbackSkyLocation = skyLocation;
    }
    const found = safeLocation(region, x, z);
    if (found) return found;
  }
  return fallbackSkyLocation;
}

function resolveRegion(player: Player, regionId?: string): RtpRegion | undefined {
  const regions = listRtpRegions(player);
  if (regionId) return regions.find((region) => region.id === regionId || region.name.toLowerCase() === regionId.toLowerCase());
  const defaultId = state.rtp.config.defaultRegionId;
  if (defaultId) return regions.find((region) => region.id === defaultId) ?? regions[0];
  return regions[0];
}

function applyProtection(player: Player, protection: RtpProtection): void {
  if (!protection.enabled) return;
  const durationTicks = Math.max(1, Math.floor(protection.durationSeconds * 20));
  protectedByPlayerId.set(getPlayerId(player), { until: Date.now() + Math.max(1, protection.durationSeconds) * 1000, protection });
  try {
    if (protection.slowFallingEffect) player.addEffect("slow_falling", durationTicks, { amplifier: 0, showParticles: false });
    if (protection.resistanceEffect) player.addEffect("resistance", durationTicks, { amplifier: 4, showParticles: false });
  } catch {
  }
}

export function randomTeleport(player: Player, regionId?: string): { ok: boolean; message: string; needsSelection?: boolean } {
  if (!enabled()) return { ok: false, message: "RTP is disabled." };
  if (isPlayerInCombat(player)) return { ok: false, message: "You cannot RTP while in combat." };
  const playerId = getPlayerId(player);
  const now = Date.now();
  const cooldownUntil = cooldownByPlayerId.get(playerId) ?? 0;
  if (cooldownUntil > now) return { ok: false, message: `RTP cooldown: ${Math.ceil((cooldownUntil - now) / 1000)}s.` };
  const regions = listRtpRegions(player);
  if (!regionId && regions.length > 1) return { ok: false, message: "Choose an RTP region.", needsSelection: true };
  const region = resolveRegion(player, regionId);
  if (!region) return { ok: false, message: "No RTP region is available." };
  const location = findRandomLocation(region);
  if (!location) return { ok: false, message: "Could not find a safe RTP location. Try again." };
  const destination = { x: location.x, y: Math.min(319, location.y + Math.max(1, region.skyHeightOffset)), z: location.z };
  applyProtection(player, region.protection);
  player.teleport(destination, { dimension: world.getDimension(region.dimensionId) });
  cooldownByPlayerId.set(playerId, now + Math.max(0, region.cooldownSeconds ?? state.rtp.config.cooldownSeconds) * 1000);
  return { ok: true, message: `Teleported to ${region.name}.` };
}

export function commitRtpRegion(region: RtpRegion): { ok: boolean; message: string } {
  if (!region.id) return { ok: false, message: "Region ID is required." };
  const bounds = normalizeBounds(region.min, region.max);
  region.min = bounds.min;
  region.max = bounds.max;
  state.rtp.regions[region.id] = region;
  saveRtp();
  return { ok: true, message: `Saved RTP region ${region.name}.` };
}

export function shouldCancelRtpDamage(player: Player, cause?: string): boolean {
  const entry = protectedByPlayerId.get(getPlayerId(player));
  if (!entry) return false;
  if (Date.now() > entry.until) {
    protectedByPlayerId.delete(getPlayerId(player));
    return false;
  }
  if (!entry.protection.enabled) return false;
  if (entry.protection.preventFallDamage && cause === EntityDamageCause.fall) return true;
  if (entry.protection.preventFireDamage && (cause === EntityDamageCause.fire || cause === EntityDamageCause.fireTick || cause === EntityDamageCause.lava)) return true;
  if (entry.protection.preventPvpDamage && cause === EntityDamageCause.entityAttack) return true;
  if (entry.protection.preventMobDamage && cause === EntityDamageCause.entityAttack) return true;
  return false;
}

export function clearRtpRuntimeForPlayer(playerId: string): void {
  cooldownByPlayerId.delete(playerId);
  protectedByPlayerId.delete(playerId);
}
