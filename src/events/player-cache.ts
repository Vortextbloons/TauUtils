import { system, world, type Player } from "@minecraft/server";

let cachedPlayersTick = -1;
let cachedPlayers: Player[] = [];

/**
 * Per-tick shared player list. Reuses one world.getAllPlayers() call per tick
 * across all event handlers and background tasks in this tick's pass.
 */
export function getCachedPlayers(): Player[] {
  if (cachedPlayersTick !== system.currentTick) {
    cachedPlayers = world.getAllPlayers();
    cachedPlayersTick = system.currentTick;
  }
  return cachedPlayers;
}
