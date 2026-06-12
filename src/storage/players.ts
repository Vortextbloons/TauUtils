import { Player, world } from "@minecraft/server";
import {
  type PlayerStats,
  type RankDefinition,
} from "../types";
import { getPlayerTeam } from "../teams";
import {
  state,
  defaultPlayerStats,
  markStatsPlayerDirty,
  markStatsPlayerIdsDirty,
} from "./state";
import { saveRanks } from "./save";
import { normalizeKey, isOperator, getScore } from "./helpers";

export function getRankById(rankId: string): RankDefinition | undefined {
  return state.ranks.ranks[rankId];
}

export function getPlayerRank(playerName: string): RankDefinition | undefined {
  const rankId = state.ranks.playerRanks[playerName];
  if (rankId) {
    const rank = getRankById(rankId);
    if (rank) return rank;
  }
  const defaultId = state.ranks.defaultRankId;
  if (defaultId) return getRankById(defaultId);
  return undefined;
}

export function setDefaultRank(rankId: string): boolean {
  if (!getRankById(rankId)) return false;
  state.ranks.defaultRankId = rankId;
  saveRanks();
  return true;
}

export function assignRank(playerName: string, rankId: string): boolean {
  if (!getRankById(rankId)) return false;
  state.ranks.playerRanks[playerName] = rankId;
  saveRanks();
  return true;
}

export function removeRank(playerName: string): boolean {
  if (!state.ranks.playerRanks[playerName]) return false;
  delete state.ranks.playerRanks[playerName];
  saveRanks();
  return true;
}

export function hasPermission(player: Player, permission: string): boolean {
  if (isOperator(player)) return true;
  const rank = getPlayerRank(player.name);
  if (!rank || rank.permissions.length === 0) return false;
  const perm = permission.toLowerCase();
  for (const p of rank.permissions) {
    const lower = p.toLowerCase();
    if (lower === "*") return true;
    if (lower === perm) return true;
    if (lower.endsWith("*")) {
      const prefix = lower.slice(0, -1);
      if (perm.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function formatChatMessage(player: Player, message: string): string {
  if (!state.chat.enabled) return `${player.name}: ${message}`;

  const rank = getPlayerRank(player.name);
  const template = rank?.chatFormat ?? state.chat.template;
  const rankName = rank ? `${rank.color}${rank.name}§r` : "";
  const rankPrefix = rank?.prefix ?? "";
  const rankSuffix = rank?.suffix ?? "";
  const team = getPlayerTeam(player);
  const teamTag = team ? `${team.color}[${team.tag}]§r` : "";
  const money = getScore(player, "money") ?? 0;

  let result = template;
  result = result.replace(/\[name\]/g, player.name);
  result = result.replace(/\[rank\]/g, rankName);
  result = result.replace(/\[rank_prefix\]/g, rankPrefix);
  result = result.replace(/\[rank_suffix\]/g, rankSuffix);
  result = result.replace(/\[team\]/g, teamTag);
  result = result.replace(/\[money\]/g, String(money));
  result = result.replace(/\[message\]/g, message);

  return result;
}

export function getPlayerId(player: Player): string {
  const existing = state.stats.playerIds[player.name];
  if (existing) return existing;
  const rawId = player.id || player.name;
  const generated = `tau-${normalizeKey(rawId).replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
  state.stats.playerIds[player.name] = generated;
  state.stats.players[generated] ??= defaultPlayerStats();
  markStatsPlayerIdsDirty();
  markStatsPlayerDirty(generated);
  return generated;
}

export function getPlayerStats(player: Player): PlayerStats {
  const id = getPlayerId(player);
  state.stats.players[id] ??= defaultPlayerStats();
  state.stats.players[id].lastSeenAt = Date.now();
  return state.stats.players[id];
}

export function incrementStat(player: Player, key: keyof PlayerStats, amount = 1): number {
  const id = getPlayerId(player);
  const stats = getPlayerStats(player);
  stats[key] = (stats[key] ?? 0) + amount;
  markStatsPlayerDirty(id);
  return stats[key];
}

export function setStat(player: Player, key: keyof PlayerStats, value: number): void {
  const id = getPlayerId(player);
  const stats = getPlayerStats(player);
  stats[key] = value;
  markStatsPlayerDirty(id);
}

export function resetStats(player: Player): void {
  const id = getPlayerId(player);
  state.stats.players[id] = defaultPlayerStats();
  markStatsPlayerDirty(id);
}

export function getPlayerStatsById(playerId: string): PlayerStats {
  state.stats.players[playerId] ??= defaultPlayerStats();
  if (state.stats.players[playerId].lastSeenAt === 0) state.stats.players[playerId].lastSeenAt = Date.now();
  return state.stats.players[playerId];
}

export function setPlayerStatById(playerId: string, key: keyof PlayerStats, value: number): void {
  state.stats.players[playerId] ??= defaultPlayerStats();
  state.stats.players[playerId][key] = value;
  markStatsPlayerDirty(playerId);
}

export function getKnownPlayerIds(): string[] {
  return Object.values(state.stats.playerIds);
}

export function getOnlinePlayerByName(name: string): Player | undefined {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return undefined;
  return world.getAllPlayers().find((player) => player.name.toLowerCase() === normalized);
}

export function getOnlinePlayerById(playerId: string): Player | undefined {
  return world.getAllPlayers().find((player) => getPlayerId(player) === playerId);
}

export function getOnlinePlayersExcept(player: Player): Player[] {
  return world.getAllPlayers().filter((entry) => entry.id !== player.id);
}
