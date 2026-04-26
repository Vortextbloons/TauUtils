import { Player, world } from "@minecraft/server";
import { getPlayerId, saveWarps, state } from "./storage";
import { type WarpDefinition } from "./tau-models";

function normalizeWarpId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

export function listWarps(): WarpDefinition[] {
  return Object.values(state.warps.warps).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function createWarp(player: Player, nameRaw: string, categoryRaw?: string): { ok: boolean; message: string } {
  if (!state.warps.config.enabled) return { ok: false, message: "Warps are disabled." };
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
  if (!state.warps.config.enabled) return { ok: false, message: "Warps are disabled." };
  const id = normalizeWarpId(warpIdOrName);
  const warp = state.warps.warps[id] ?? Object.values(state.warps.warps).find((entry) => normalizeWarpId(entry.name) === id);
  if (!warp) return { ok: false, message: "Warp not found." };
  if (!state.warps.config.crossDimension && player.dimension.id !== warp.dimensionId) {
    return { ok: false, message: "Cross-dimension warps are disabled." };
  }
  const dimension = player.dimension.id === warp.dimensionId ? player.dimension : world.getDimension(warp.dimensionId);
  player.teleport(warp.position, { dimension });
  return { ok: true, message: `Teleported to ${warp.name}.` };
}

export function getWarpCategories(): string[] {
  return state.warps.config.categories;
}
