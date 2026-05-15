import { Player } from "@minecraft/server";
import { getPlayerId } from "../storage/players";
import { state } from "../storage/state";

export type CombatTagEntry = {
  expiresAt: number;
};

export const combatTagsByPlayerId = new Map<string, CombatTagEntry>();

export function isCombatFeatureActive(): boolean {
  return state.config.features.combat !== false && state.combat.config.enabled;
}

export function hasActiveCombatTag(playerId: string, now: number = Date.now()): boolean {
  const entry = combatTagsByPlayerId.get(playerId);
  if (!entry) return false;
  if (entry.expiresAt > now) return true;
  combatTagsByPlayerId.delete(playerId);
  return false;
}

export function isPlayerInCombat(player: Player): boolean {
  if (!isCombatFeatureActive()) return false;
  return hasActiveCombatTag(getPlayerId(player));
}

export function getCombatStatusText(player: Player): string {
  return isPlayerInCombat(player) ? "§cIn Combat§r" : "§aSafe§r";
}
