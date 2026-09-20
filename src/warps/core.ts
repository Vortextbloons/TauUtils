import { Player } from "@minecraft/server";
import { getPlayerId, getPlayerRank, isOperator, saveWarps, state } from "../storage";
import { isFeatureActive } from "../storage/helpers";
import { requestPlayerTeleport } from "../shared/teleport-service";
import { type WarpDefinition } from "../types";

const warpCooldownUntilByKey = new Map<string, number>();

function normalizeWarpId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function warpCooldownKey(playerId: string, warpId: string): string {
  return `${playerId}:${warpId}`;
}

export function listWarps(): WarpDefinition[] {
  return Object.values(state.warps.warps).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function isWarpVisibleTo(player: Player, warp: WarpDefinition): boolean {
  if (isOperator(player)) return true;
  if (!warp.public) return false;
  if (warp.allowedRanks.length === 0) return true;
  const rank = getPlayerRank(player.name);
  if (!rank) return false;
  return warp.allowedRanks.some((entry) => entry.toLowerCase() === rank.id.toLowerCase());
}

export function listVisibleWarps(player: Player): WarpDefinition[] {
  return listWarps().filter((warp) => isWarpVisibleTo(player, warp));
}

export function clearWarpRuntimeForPlayer(playerId: string): void {
  for (const key of [...warpCooldownUntilByKey.keys()]) {
    if (key.startsWith(`${playerId}:`)) warpCooldownUntilByKey.delete(key);
  }
}

export function createWarp(player: Player, nameRaw: string, categoryRaw?: string): { ok: boolean; message: string } {
  if (!isFeatureActive("warps", state.warps.config.enabled)) return { ok: false, message: "Warps are disabled." };
  const name = String(nameRaw ?? "").trim();
  if (!name) return { ok: false, message: "Warp name is required." };
  const id = normalizeWarpId(name);
  if (!id) return { ok: false, message: "Invalid warp name." };
  if (state.warps.warps[id]) return { ok: false, message: "That warp already exists." };
  if (Object.keys(state.warps.warps).length >= state.warps.config.maxWarps) return { ok: false, message: "Warp limit reached." };

  state.warps.warps[id] = {
    id,
    name,
    description: undefined,
    icon: undefined,
    category: String(categoryRaw ?? "spawn").trim() || "spawn",
    dimensionId: player.dimension.id,
    position: { x: player.location.x, y: player.location.y, z: player.location.z },
    public: state.warps.config.defaultPublic,
    allowedRanks: [],
    cooldownSeconds: state.warps.config.cooldownSeconds,
  };
  saveWarps();
  return { ok: true, message: `Created warp ${name}.` };
}

export function setWarpLocation(player: Player, warpIdOrName: string): { ok: boolean; message: string } {
  const id = normalizeWarpId(warpIdOrName);
  const warp = state.warps.warps[id] ?? Object.values(state.warps.warps).find((entry) => normalizeWarpId(entry.name) === id);
  if (!warp) return { ok: false, message: "Warp not found." };
  warp.dimensionId = player.dimension.id;
  warp.position = { x: player.location.x, y: player.location.y, z: player.location.z };
  saveWarps();
  return { ok: true, message: `Updated warp ${warp.name}.` };
}

export function deleteWarp(warpIdOrName: string): { ok: boolean; message: string } {
  const id = normalizeWarpId(warpIdOrName);
  const warp = state.warps.warps[id] ?? Object.values(state.warps.warps).find((entry) => normalizeWarpId(entry.name) === id);
  if (!warp) return { ok: false, message: "Warp not found." };
  delete state.warps.warps[warp.id];
  saveWarps();
  return { ok: true, message: `Deleted warp ${warp.name}.` };
}

export function teleportToWarp(player: Player, warpIdOrName: string): { ok: boolean; message: string } {
  if (!isFeatureActive("warps", state.warps.config.enabled)) return { ok: false, message: "Warps are disabled." };
  const id = normalizeWarpId(warpIdOrName);
  const warp = state.warps.warps[id] ?? Object.values(state.warps.warps).find((entry) => normalizeWarpId(entry.name) === id);
  if (!warp) return { ok: false, message: "Warp not found." };
  if (!isWarpVisibleTo(player, warp)) return { ok: false, message: "You cannot use that warp." };
  if (!state.warps.config.crossDimension && player.dimension.id !== warp.dimensionId) {
    return { ok: false, message: "Cross-dimension warps are disabled." };
  }
  const now = Date.now();
  const cooldownMs = Math.max(0, warp.cooldownSeconds ?? state.warps.config.cooldownSeconds) * 1000;
  const key = warpCooldownKey(getPlayerId(player), warp.id);
  const cooldownUntil = warpCooldownUntilByKey.get(key) ?? 0;
  if (cooldownUntil > now) {
    return { ok: false, message: `Warp cooldown: ${Math.ceil((cooldownUntil - now) / 1000)}s.` };
  }
  const result = requestPlayerTeleport(
    player,
    { ...warp.position, dimensionId: warp.dimensionId },
    { blockCombat: true },
  );
  if (!result.ok) return result;
  if (cooldownMs > 0) warpCooldownUntilByKey.set(key, now + cooldownMs);
  return { ok: true, message: `Teleported to ${warp.name}.` };
}
