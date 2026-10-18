import { PlatformType, type Player } from "@minecraft/server";
import { isFeatureEnabled, isOperator, state } from "../storage";

/** Returns true when the player was kicked. Unknown platforms are allowed. */
export function enforcePcAccess(player: Player): boolean {
  if (!isFeatureEnabled("moderation") || !state.moderation.pcAccess.enabled) return false;
  try {
    if (!player.isValid || isOperator(player)) return false;
    if (player.clientSystemInfo.platformType !== PlatformType.Desktop) return false;
    const name = player.name.toLowerCase();
    if (state.moderation.pcAccess.whitelist.some((entry) => entry.toLowerCase() === name)) return false;
    // JSON quoting keeps gamertags out of command syntax; the reason is fixed.
    player.dimension.runCommand(`kick ${JSON.stringify(player.name)} PC players are not allowed. Ask an admin to add you to the PC whitelist.`);
    return true;
  } catch {
    return false;
  }
}
