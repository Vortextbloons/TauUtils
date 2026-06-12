import { Player, world } from "@minecraft/server";
import { isFeatureEnabled, saveTeamHomes, state } from "../storage";
import { type TeamDefinition, type TeamHomeConfig, type TeamHomeLocation, type TeamHomeStore } from "../types";
import { isPlayerInCombat } from "../combat";
import { getPlayerTeam, isTeamMember, isTeamOwnerOrAdmin } from "../teams";
import { canTeleportTo } from "../shared/teleport-guard";

function ensureHomesForTeam(team: TeamDefinition): Record<string, TeamHomeLocation> {
  if (!state.teamHomes.homesByTeamId[team.id]) state.teamHomes.homesByTeamId[team.id] = {};
  return state.teamHomes.homesByTeamId[team.id];
}

function normalizeHomeName(raw: string | undefined): string {
  return String(raw ?? "home").trim().toLowerCase() || "home";
}

export function getTeamHomes(team: TeamDefinition): Record<string, TeamHomeLocation> {
  return state.teamHomes.homesByTeamId[team.id] ?? {};
}

export function listTeamHomeNames(team: TeamDefinition): string[] {
  return Object.keys(getTeamHomes(team)).sort((a, b) => a.localeCompare(b));
}

function requireFeatureEnabled(): { ok: true } | { ok: false; message: string } {
  if (!isFeatureEnabled("teamHomes")) return { ok: false, message: "Team homes are disabled." };
  if (!state.teamHomes.config.enabled) return { ok: false, message: "Team homes are disabled." };
  return { ok: true };
}

function requirePlayerTeam(player: Player): { ok: true; team: TeamDefinition } | { ok: false; message: string } {
  const team = getPlayerTeam(player);
  if (!team) return { ok: false, message: "You are not in a team." };
  return { ok: true, team };
}

export function setTeamHome(player: Player, rawName?: string): { ok: boolean; message: string } {
  const feat = requireFeatureEnabled();
  if (!feat.ok) return feat;
  const teamRes = requirePlayerTeam(player);
  if (!teamRes.ok) return teamRes;
  if (!isTeamOwnerOrAdmin(player, teamRes.team)) return { ok: false, message: "Only the team owner or admin can set team homes." };
  const name = normalizeHomeName(rawName);
  const homes = ensureHomesForTeam(teamRes.team);
  if (!homes[name] && Object.keys(homes).length >= Math.max(1, state.teamHomes.config.maxHomesPerTeam)) {
    return { ok: false, message: `Max team homes reached (${state.teamHomes.config.maxHomesPerTeam}).` };
  }
  homes[name] = {
    x: player.location.x,
    y: player.location.y,
    z: player.location.z,
    dimensionId: player.dimension.id,
  };
  saveTeamHomes();
  return { ok: true, message: `Team home "${name}" set.` };
}

export function deleteTeamHome(player: Player, rawName?: string): { ok: boolean; message: string } {
  const feat = requireFeatureEnabled();
  if (!feat.ok) return feat;
  const teamRes = requirePlayerTeam(player);
  if (!teamRes.ok) return teamRes;
  if (!isTeamOwnerOrAdmin(player, teamRes.team)) return { ok: false, message: "Only the team owner or admin can delete team homes." };
  const name = normalizeHomeName(rawName);
  const homes = getTeamHomes(teamRes.team);
  if (!homes[name]) return { ok: false, message: `Team home "${name}" not found.` };
  delete homes[name];
  if (state.teamHomes.homesByTeamId[teamRes.team.id]) delete state.teamHomes.homesByTeamId[teamRes.team.id][name];
  saveTeamHomes();
  return { ok: true, message: `Team home "${name}" deleted.` };
}

export function teleportTeamHome(player: Player, rawName?: string): { ok: boolean; message: string } {
  const feat = requireFeatureEnabled();
  if (!feat.ok) return feat;
  const teamRes = requirePlayerTeam(player);
  if (!teamRes.ok) return teamRes;
  if (!isTeamMember(player, teamRes.team)) return { ok: false, message: "You are not a member of this team." };
  const name = normalizeHomeName(rawName);
  const home = getTeamHomes(teamRes.team)[name];
  if (!home) return { ok: false, message: `Team home "${name}" not found.` };
  if (state.teamHomes.config.blockWhileInCombat && isPlayerInCombat(player)) {
    return { ok: false, message: "You cannot teleport to a team home while in combat." };
  }
  if (!state.teamHomes.config.allowCrossDimension && player.dimension.id !== home.dimensionId) {
    return { ok: false, message: "Cross-dimension team homes are disabled." };
  }
  const guard = canTeleportTo(player, { ...home, dimensionId: home.dimensionId });
  if (!guard.ok) return guard;
  const dimension = world.getDimension(home.dimensionId);
  player.teleport({ x: home.x, y: home.y, z: home.z }, { dimension });
  return { ok: true, message: `Teleported to team home "${name}".` };
}

export function updateTeamHomesConfig(partial: Partial<TeamHomeConfig>): { ok: boolean; message: string } {
  if (!isFeatureEnabled("teamHomes")) return { ok: false, message: "Team homes are disabled." };
  const cfg = state.teamHomes.config;
  if (partial.enabled !== undefined) cfg.enabled = !!partial.enabled;
  if (partial.maxHomesPerTeam !== undefined) {
    const n = Math.floor(Number(partial.maxHomesPerTeam));
    if (!Number.isFinite(n) || n < 1) return { ok: false, message: "Max homes per team must be at least 1." };
    cfg.maxHomesPerTeam = n;
  }
  if (partial.allowCrossDimension !== undefined) cfg.allowCrossDimension = !!partial.allowCrossDimension;
  if (partial.blockWhileInCombat !== undefined) cfg.blockWhileInCombat = !!partial.blockWhileInCombat;
  saveTeamHomes();
  return { ok: true, message: "Team homes config updated." };
}

export function summarizeTeamHomes(team: TeamDefinition): string {
  const names = listTeamHomeNames(team);
  if (names.length === 0) return `Team ${team.name} has no team homes set.`;
  return `Team ${team.name} homes (${names.length}): ${names.join(", ")}`;
}

export function pruneTeamHomesForInactiveTeams(activeTeamIds: Set<string>): number {
  let removed = 0;
  for (const teamId of Object.keys(state.teamHomes.homesByTeamId)) {
    if (!activeTeamIds.has(teamId)) {
      delete state.teamHomes.homesByTeamId[teamId];
      removed += 1;
    }
  }
  if (removed > 0) saveTeamHomes();
  return removed;
}

export type { TeamHomeLocation, TeamHomeConfig, TeamHomeStore };
