import { tell } from "../storage";

export function tellResult(
  player: import("@minecraft/server").Player,
  result: { ok: boolean; message: string }
): void {
  tell(player, result.ok ? `§a${result.message}` : `§c${result.message}`);
}
