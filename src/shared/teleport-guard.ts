import { Player } from "@minecraft/server";
import { isPlayerInCombat } from "../combat";
import { shouldCancelAreaTeleport } from "../custom-areas";
import { shouldCancelClaimEntityInteract, shouldCancelClaimItemUse } from "../claims";

type Destination = {
  x: number;
  y: number;
  z: number;
  dimensionId: string;
};

export function canTeleportTo(player: Player, destination: Destination, options: { blockCombat?: boolean } = {}): { ok: boolean; message: string } {
  if (options.blockCombat && isPlayerInCombat(player)) {
    return { ok: false, message: "You cannot teleport while in combat." };
  }
  const location = { x: destination.x, y: destination.y, z: destination.z };
  if (shouldCancelAreaTeleport(player, location, destination.dimensionId)) {
    return { ok: false, message: "You cannot teleport into that protected area." };
  }
  if (shouldCancelClaimItemUse(player, location, destination.dimensionId) || shouldCancelClaimEntityInteract(player, location, destination.dimensionId)) {
    return { ok: false, message: "You cannot teleport into that protected claim." };
  }
  return { ok: true, message: "OK" };
}
