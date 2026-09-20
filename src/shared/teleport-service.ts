import { Player, world } from "@minecraft/server";
import { canTeleportTo } from "./teleport-guard";

export type TeleportDestination = {
  x: number;
  y: number;
  z: number;
  dimensionId: string;
};

export type TeleportRequestOptions = {
  blockCombat?: boolean;
  crossDimensionAllowed?: boolean;
};

export type TeleportResult = {
  ok: boolean;
  message: string;
};

/**
 * Single choke point for player teleports: one isValid check, one
 * guard pass (combat/area/claim), one dimension resolve with fallback.
 */
export function requestPlayerTeleport(
  player: Player,
  destination: TeleportDestination,
  options: TeleportRequestOptions = {},
): TeleportResult {
  if (!player.isValid) {
    return { ok: false, message: "Player is no longer valid." };
  }
  if (options.crossDimensionAllowed === false && player.dimension.id !== destination.dimensionId) {
    return { ok: false, message: "Cross-dimension teleport is disabled." };
  }
  const guard = canTeleportTo(player, destination, { blockCombat: options.blockCombat });
  if (!guard.ok) return guard;
  let dimension;
  try {
    dimension =
      player.dimension.id === destination.dimensionId
        ? player.dimension
        : world.getDimension(destination.dimensionId);
  } catch {
    return { ok: false, message: "Destination dimension is not loaded." };
  }
  try {
    player.teleport(
      { x: destination.x, y: destination.y, z: destination.z },
      { dimension },
    );
  } catch {
    return { ok: false, message: "Teleport failed." };
  }
  return { ok: true, message: "Teleported." };
}
