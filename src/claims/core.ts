import { Player, Vector3, world, system } from "@minecraft/server";
import { getPlayerId, getOnlinePlayerById, isFeatureEnabled, isOperator, saveClaims, state, tell } from "../storage";
import { getPlayerTeam } from "../teams";
import { renderTemplate } from "../shared/templates";
import type { ClaimDefinition, ClaimFlags, ClaimMemberRole } from "../types";

type RuntimeClaim = { claim: ClaimDefinition };
type ClaimRuntimeCache = { byDimension: Map<string, RuntimeClaim[]> };

const playerClaimState = new Map<string, string | undefined>();
let cache: ClaimRuntimeCache | undefined;
let claimJobId: number | undefined;

function enabled(): boolean {
  return isFeatureEnabled("claims") && state.claims.config.enabled;
}

export function normalizeClaimBounds(a: Vector3, b: Vector3): { min: Vector3; max: Vector3 } {
  return normalizedBounds(a, b);
}

function normalizedBounds(a: Vector3, b: Vector3): { min: Vector3; max: Vector3 } {
  return {
    min: { x: Math.min(Math.floor(a.x), Math.floor(b.x)), y: Math.min(Math.floor(a.y), Math.floor(b.y)), z: Math.min(Math.floor(a.z), Math.floor(b.z)) },
    max: { x: Math.max(Math.floor(a.x), Math.floor(b.x)), y: Math.max(Math.floor(a.y), Math.floor(b.y)), z: Math.max(Math.floor(a.z), Math.floor(b.z)) },
  };
}

function pointInside(claim: ClaimDefinition, location: Vector3, dimensionId: string): boolean {
  return claim.enabled && claim.dimensionId === dimensionId &&
    location.x >= claim.min.x && location.x <= claim.max.x &&
    location.y >= claim.min.y && location.y <= claim.max.y &&
    location.z >= claim.min.z && location.z <= claim.max.z;
}

function intersects(a: ClaimDefinition, min: Vector3, max: Vector3, dimensionId: string): boolean {
  if (a.dimensionId !== dimensionId) return false;
  return a.min.x <= max.x && a.max.x >= min.x && a.min.y <= max.y && a.max.y >= min.y && a.min.z <= max.z && a.max.z >= min.z;
}

function buildCache(): ClaimRuntimeCache {
  const byDimension = new Map<string, RuntimeClaim[]>();
  for (const claim of Object.values(state.claims.claims).filter((entry) => entry.enabled)) {
    const list = byDimension.get(claim.dimensionId) ?? [];
    list.push({ claim });
    byDimension.set(claim.dimensionId, list);
  }
  for (const list of byDimension.values()) list.sort((a, b) => b.claim.priority - a.claim.priority || b.claim.createdAt - a.claim.createdAt);
  return { byDimension };
}

function getCache(): ClaimRuntimeCache {
  cache ??= buildCache();
  return cache;
}

export function invalidateClaimRuntimeState(): void {
  cache = undefined;
  playerClaimState.clear();
}

export function getClaimAt(location: Vector3, dimensionId: string): ClaimDefinition | undefined {
  if (!enabled()) return undefined;
  return (getCache().byDimension.get(dimensionId) ?? []).find((runtime) => pointInside(runtime.claim, location, dimensionId))?.claim;
}

function roleAllows(role: ClaimMemberRole | undefined, action: "build" | "manage"): boolean {
  if (action === "manage") return role === "manager";
  return role === "member" || role === "manager";
}

export function canManageClaim(player: Player, claim: ClaimDefinition): boolean {
  if (isOperator(player)) return true;
  const playerId = getPlayerId(player);
  if (claim.ownerPlayerId === playerId) return true;
  return roleAllows(claim.members[playerId], "manage");
}

function hasClaimAccess(player: Player, claim: ClaimDefinition): boolean {
  if (isOperator(player)) return true;
  const playerId = getPlayerId(player);
  if (claim.ownerPlayerId === playerId) return true;
  if (roleAllows(claim.members[playerId], "build")) return true;
  const team = getPlayerTeam(player);
  if (!team) return false;
  if (claim.flags.allowTeamAccess && claim.teamId === team.id) return true;
  return roleAllows(claim.trustedTeams[team.id], "build");
}

function resolvedFlags(claim: ClaimDefinition): ClaimFlags {
  return {
    ...state.claims.config.defaultFlags,
    ...claim.flags,
    protectionEnabled: state.claims.config.protectionEnabled && (state.claims.config.allowPlayersToToggleProtection ? claim.flags.protectionEnabled : state.claims.config.defaultFlags.protectionEnabled),
  };
}

function shouldCancel(player: Player, location: Vector3, dimensionId: string, flag: keyof ClaimFlags): boolean {
  if (isOperator(player)) return false;
  const claim = getClaimAt(location, dimensionId);
  if (!claim) return false;
  const flags = resolvedFlags(claim);
  if (!flags.protectionEnabled) return false;
  if (hasClaimAccess(player, claim)) return false;
  return flags[flag] === false;
}

export function shouldCancelClaimBlockBreak(player: Player, location: Vector3, dimensionId: string): boolean {
  return shouldCancel(player, location, dimensionId, "blockBreak");
}

export function shouldCancelClaimBlockPlace(player: Player, location: Vector3, dimensionId: string): boolean {
  return shouldCancel(player, location, dimensionId, "blockPlace");
}

export function shouldCancelClaimItemUse(player: Player, location = player.location, dimensionId = player.dimension.id): boolean {
  return shouldCancel(player, location, dimensionId, "itemUse");
}

export function shouldCancelClaimEntityInteract(player: Player, location = player.location, dimensionId = player.dimension.id): boolean {
  return shouldCancel(player, location, dimensionId, "entityInteract");
}

export function shouldCancelClaimPvp(victim: Player, attacker: Player): boolean {
  return shouldCancel(attacker, victim.location, victim.dimension.id, "pvp");
}

export function validateClaimBounds(ownerPlayerId: string, min: Vector3, max: Vector3, dimensionId: string, ignoreClaimId?: string, teamId?: string): { ok: boolean; message: string } {
  const cfg = state.claims.config;
  const size = { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 };
  if (size.x < cfg.minClaimSize.x || size.y < cfg.minClaimSize.y || size.z < cfg.minClaimSize.z) return { ok: false, message: "Claim is smaller than the admin minimum size." };
  if (size.x > cfg.maxClaimSize.x || size.y > cfg.maxClaimSize.y || size.z > cfg.maxClaimSize.z) return { ok: false, message: "Claim is larger than the admin maximum size." };
  if (size.x * size.y * size.z > cfg.maxClaimVolume) return { ok: false, message: "Claim volume is larger than the admin maximum." };
  if ((state.claims.playerClaimIds[ownerPlayerId]?.filter((id) => id !== ignoreClaimId).length ?? 0) >= cfg.maxClaimsPerPlayer) return { ok: false, message: "You have reached the admin claim limit." };
  if (teamId && (state.claims.teamClaimIds[teamId]?.filter((id) => id !== ignoreClaimId).length ?? 0) >= cfg.maxClaimsPerTeam) return { ok: false, message: "Your team has reached the admin team claim limit." };
  if (!cfg.allowOverlaps) {
    for (const claim of Object.values(state.claims.claims)) {
      if (claim.id !== ignoreClaimId && intersects(claim, min, max, dimensionId)) return { ok: false, message: "Claims cannot overlap." };
    }
  }
  return { ok: true, message: "OK" };
}

export function commitClaim(claim: ClaimDefinition): { ok: boolean; message: string } {
  const bounds = normalizedBounds(claim.min, claim.max);
  const validation = validateClaimBounds(claim.ownerPlayerId, bounds.min, bounds.max, claim.dimensionId, state.claims.claims[claim.id] ? claim.id : undefined, claim.teamId);
  if (!validation.ok) return validation;
  claim.min = bounds.min;
  claim.max = bounds.max;
  claim.updatedAt = Date.now();
  state.claims.claims[claim.id] = claim;
  state.claims.playerClaimIds = {};
  state.claims.teamClaimIds = {};
  for (const entry of Object.values(state.claims.claims)) {
    state.claims.playerClaimIds[entry.ownerPlayerId] ??= [];
    state.claims.playerClaimIds[entry.ownerPlayerId].push(entry.id);
    if (entry.teamId) {
      state.claims.teamClaimIds[entry.teamId] ??= [];
      state.claims.teamClaimIds[entry.teamId].push(entry.id);
    }
  }
  if (!saveClaims()) return { ok: false, message: "Failed to save claim." };
  invalidateClaimRuntimeState();
  return { ok: true, message: `Saved claim ${claim.name}.` };
}

function sendAnnouncement(player: Player, claim: ClaimDefinition, entering: boolean): void {
  const raw = entering ? claim.enterMessage : claim.leaveMessage;
  const fallback = entering ? `§7Entering claim: §b${claim.name}` : `§7Leaving claim: §b${claim.name}`;
  const message = renderTemplate(raw || fallback, { player, extra: { claim: claim.name, claim_id: claim.id } });
  const target = claim.announcementTarget;
  if (target === "global") world.sendMessage(message);
  else if (target === "owner") tell(getOnlinePlayerById(claim.ownerPlayerId) ?? player, message);
  else if (target === "team" && claim.teamId) {
    const team = state.teams.teams[claim.teamId];
    for (const online of world.getAllPlayers()) {
      const id = getPlayerId(online);
      if (team && (team.ownerPlayerId === id || team.memberPlayerIds.includes(id))) tell(online, message);
    }
  } else if (target === "claim_members") {
    for (const online of world.getAllPlayers()) {
      const id = getPlayerId(online);
      if (id === claim.ownerPlayerId || claim.members[id]) tell(online, message);
    }
  } else tell(player, message);
}

export function processClaims(): void {
  if (!enabled() || claimJobId !== undefined) return;
  claimJobId = system.runJob(processClaimsJob());
}

function* processClaimsJob(): Generator<void, void, void> {
  for (const player of world.getAllPlayers()) {
    if (!enabled()) break;
    const playerId = getPlayerId(player);
    const previous = playerClaimState.get(playerId);
    const current = getClaimAt(player.location, player.dimension.id);
    if (previous !== current?.id) {
      if (previous) {
        const old = state.claims.claims[previous];
        if (old?.announceLeave) sendAnnouncement(player, old, false);
      }
      if (current?.announceEnter) sendAnnouncement(player, current, true);
      playerClaimState.set(playerId, current?.id);
    }
    yield;
  }
  claimJobId = undefined;
}
