import { world } from "@minecraft/server";
import { getPlayerId, savePlots, saveTeams, state } from "./storage";
import { clearPlayerPlot, reconcileAllPlotState } from "./plots";
function normalizeTeamId(value) {
    return value.trim().toLowerCase().replace(/\s+/g, "_");
}
function normalizeTag(value) {
    return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 8);
}
function getTeamByPlayerId(playerId) {
    const teamId = state.teams.playerTeamIds[playerId];
    if (!teamId)
        return undefined;
    const team = state.teams.teams[teamId];
    if (!team)
        return undefined;
    if (team.ownerPlayerId === playerId)
        return team;
    if (!team.memberPlayerIds.includes(playerId))
        return undefined;
    return team;
}
function getOnlinePlayerById(playerId) {
    return world.getAllPlayers().find((player) => getPlayerId(player) === playerId);
}
function getTeamPlotSlotId(team) {
    return state.plots.playerToSlot[team.ownerPlayerId] ?? team.personalPlotSlotIds?.[team.ownerPlayerId];
}
function preserveMemberPersonalPlot(team, memberId) {
    if (!team.personalPlotSlotIds)
        team.personalPlotSlotIds = {};
    const slotId = team.personalPlotSlotIds[memberId] ?? state.plots.playerToSlot[memberId];
    if (!slotId)
        return undefined;
    team.personalPlotSlotIds[memberId] = slotId;
    clearPlayerPlot(memberId);
    return slotId;
}
function restoreMemberPersonalPlot(memberId, slotId) {
    if (!slotId)
        return;
    state.plots.playerToSlot[memberId] = slotId;
    const slot = state.plots.slots[slotId];
    if (slot)
        slot.occupiedByPlayerId = memberId;
}
function suspendMemberPersonalPlot(team, memberId) {
    if (!team.personalPlotSlotIds)
        team.personalPlotSlotIds = {};
    const slotId = team.personalPlotSlotIds[memberId] ?? state.plots.playerToSlot[memberId];
    if (!slotId)
        return undefined;
    team.personalPlotSlotIds[memberId] = slotId;
    delete state.plots.playerToSlot[memberId];
    const slot = state.plots.slots[slotId];
    if (slot && slot.occupiedByPlayerId === memberId) {
        slot.occupiedByPlayerId = undefined;
    }
    return slotId;
}
export function getPlayerTeam(player) {
    return getTeamByPlayerId(getPlayerId(player));
}
export function reconcileTeamAssignments() {
    let fixed = 0;
    let removed = 0;
    for (const team of Object.values(state.teams.teams)) {
        if (!team.memberPlayerIds.includes(team.ownerPlayerId)) {
            team.memberPlayerIds.unshift(team.ownerPlayerId);
            fixed += 1;
        }
        const uniqueMembers = Array.from(new Set(team.memberPlayerIds));
        if (uniqueMembers.length !== team.memberPlayerIds.length) {
            team.memberPlayerIds = uniqueMembers;
            fixed += 1;
        }
        state.teams.playerTeamIds[team.ownerPlayerId] = team.id;
        for (const memberId of team.memberPlayerIds) {
            state.teams.playerTeamIds[memberId] = team.id;
        }
    }
    for (const [playerId, teamId] of Object.entries(state.teams.playerTeamIds)) {
        const team = state.teams.teams[teamId];
        if (!team || (team.ownerPlayerId !== playerId && !team.memberPlayerIds.includes(playerId))) {
            delete state.teams.playerTeamIds[playerId];
            removed += 1;
        }
    }
    if (fixed > 0 || removed > 0)
        saveTeams();
    return { ok: true, fixed, removed };
}
export function listTeams() {
    return Object.values(state.teams.teams).sort((a, b) => a.name.localeCompare(b.name));
}
export function createTeam(owner, nameRaw, tagRaw) {
    if (!state.teams.enabled)
        return { ok: false, message: "Teams are disabled." };
    const ownerId = getPlayerId(owner);
    if (state.teams.playerTeamIds[ownerId])
        return { ok: false, message: "You are already in a team." };
    const name = String(nameRaw ?? "").trim();
    if (!name)
        return { ok: false, message: "Team name is required." };
    const id = normalizeTeamId(name);
    if (!id)
        return { ok: false, message: "Invalid team name." };
    if (state.teams.teams[id])
        return { ok: false, message: "That team already exists." };
    const team = {
        id,
        name,
        tag: normalizeTag(tagRaw ?? name.slice(0, 4)),
        color: "§f",
        ownerPlayerId: ownerId,
        memberPlayerIds: [ownerId],
        invitedPlayerIds: [],
        createdAt: Date.now(),
        inviteOnly: true,
        friendlyFire: false,
        teamPlotEnabled: false,
    };
    state.teams.teams[id] = team;
    state.teams.playerTeamIds[ownerId] = id;
    saveTeams();
    return { ok: true, message: `Created team ${team.name}.` };
}
export function inviteToTeam(owner, target) {
    const team = getPlayerTeam(owner);
    if (!team)
        return { ok: false, message: "You are not in a team." };
    if (team.ownerPlayerId !== getPlayerId(owner))
        return { ok: false, message: "Only the owner can invite players." };
    const targetId = getPlayerId(target);
    if (state.teams.playerTeamIds[targetId])
        return { ok: false, message: `${target.name} is already in a team.` };
    if (!team.invitedPlayerIds.includes(targetId))
        team.invitedPlayerIds.push(targetId);
    saveTeams();
    return { ok: true, message: `Invited ${target.name} to ${team.name}.` };
}
export function revokeTeamInvite(owner, target) {
    const team = getPlayerTeam(owner);
    if (!team)
        return { ok: false, message: "You are not in a team." };
    if (team.ownerPlayerId !== getPlayerId(owner))
        return { ok: false, message: "Only the owner can manage invites." };
    const targetId = getPlayerId(target);
    const before = team.invitedPlayerIds.length;
    team.invitedPlayerIds = team.invitedPlayerIds.filter((id) => id !== targetId);
    if (team.invitedPlayerIds.length === before)
        return { ok: false, message: `${target.name} did not have a pending invite.` };
    saveTeams();
    return { ok: true, message: `Revoked invite for ${target.name}.` };
}
export function joinTeam(player, teamIdOrName) {
    if (!state.teams.enabled)
        return { ok: false, message: "Teams are disabled." };
    const playerId = getPlayerId(player);
    if (state.teams.playerTeamIds[playerId])
        return { ok: false, message: "You are already in a team." };
    const id = normalizeTeamId(teamIdOrName);
    const team = state.teams.teams[id] ?? Object.values(state.teams.teams).find((entry) => normalizeTeamId(entry.name) === id || normalizeTag(entry.tag) === normalizeTag(id));
    if (!team)
        return { ok: false, message: "Team not found." };
    if (team.inviteOnly && !team.invitedPlayerIds.includes(playerId))
        return { ok: false, message: "That team is invite-only." };
    if (team.memberPlayerIds.length >= state.teams.maxMembers)
        return { ok: false, message: "Team is full." };
    team.memberPlayerIds.push(playerId);
    team.invitedPlayerIds = team.invitedPlayerIds.filter((id2) => id2 !== playerId);
    state.teams.playerTeamIds[playerId] = team.id;
    if (team.teamPlotEnabled) {
        suspendMemberPersonalPlot(team, playerId);
    }
    saveTeams();
    reconcileAllPlotState("team_join");
    return { ok: true, message: `Joined ${team.name}.` };
}
export function leaveTeam(player) {
    const playerId = getPlayerId(player);
    const team = getTeamByPlayerId(playerId);
    if (!team)
        return { ok: false, message: "You are not in a team." };
    if (team.ownerPlayerId === playerId)
        return { ok: false, message: "Owner must transfer ownership or disband the team." };
    const personalSlotId = team.teamPlotEnabled ? suspendMemberPersonalPlot(team, playerId) : undefined;
    team.memberPlayerIds = team.memberPlayerIds.filter((id) => id !== playerId);
    delete state.teams.playerTeamIds[playerId];
    if (team.teamPlotEnabled)
        restoreMemberPersonalPlot(playerId, personalSlotId);
    saveTeams();
    reconcileAllPlotState("team_leave");
    return { ok: true, message: `Left ${team.name}.` };
}
export function kickFromTeam(owner, target) {
    const team = getPlayerTeam(owner);
    if (!team)
        return { ok: false, message: "You are not in a team." };
    if (team.ownerPlayerId !== getPlayerId(owner))
        return { ok: false, message: "Only the owner can kick members." };
    const targetId = getPlayerId(target);
    if (targetId === team.ownerPlayerId)
        return { ok: false, message: "You cannot kick the owner." };
    if (!team.memberPlayerIds.includes(targetId))
        return { ok: false, message: `${target.name} is not in your team.` };
    const personalSlotId = team.teamPlotEnabled ? suspendMemberPersonalPlot(team, targetId) : undefined;
    team.memberPlayerIds = team.memberPlayerIds.filter((id) => id !== targetId);
    delete state.teams.playerTeamIds[targetId];
    if (team.teamPlotEnabled)
        restoreMemberPersonalPlot(targetId, personalSlotId);
    saveTeams();
    reconcileAllPlotState("team_kick");
    return { ok: true, message: `Kicked ${target.name} from ${team.name}.` };
}
export function disbandTeam(owner) {
    const team = getPlayerTeam(owner);
    if (!team)
        return { ok: false, message: "You are not in a team." };
    if (team.ownerPlayerId !== getPlayerId(owner))
        return { ok: false, message: "Only the owner can disband the team." };
    for (const memberId of team.memberPlayerIds) {
        delete state.teams.playerTeamIds[memberId];
        const personalSlotId = team.personalPlotSlotIds?.[memberId];
        if (personalSlotId) {
            restoreMemberPersonalPlot(memberId, personalSlotId);
        }
    }
    delete state.teams.teams[team.id];
    savePlots();
    saveTeams();
    reconcileAllPlotState("team_disband");
    return { ok: true, message: `Disbanded ${team.name}.` };
}
export function acceptTeamInvite(player, teamIdOrName) {
    const teamId = normalizeTeamId(teamIdOrName);
    const team = state.teams.teams[teamId] ?? Object.values(state.teams.teams).find((entry) => normalizeTeamId(entry.name) === teamId);
    if (!team)
        return { ok: false, message: "Team not found." };
    const playerId = getPlayerId(player);
    if (!team.invitedPlayerIds.includes(playerId))
        return { ok: false, message: "You were not invited to that team." };
    return joinTeam(player, team.id);
}
export function getTeamSummary(team) {
    return `${team.color}[${team.tag}]§r ${team.name} (${team.memberPlayerIds.length}/${state.teams.maxMembers})`;
}
export function setTeamFriendlyFire(owner, enabled) {
    const team = getPlayerTeam(owner);
    if (!team)
        return { ok: false, message: "You are not in a team." };
    if (team.ownerPlayerId !== getPlayerId(owner))
        return { ok: false, message: "Only the owner can change team settings." };
    team.friendlyFire = enabled;
    saveTeams();
    return { ok: true, message: `Friendly fire ${enabled ? "enabled" : "disabled"}.` };
}
export function setTeamPlotEnabled(owner, enabled) {
    const team = getPlayerTeam(owner);
    if (!team)
        return { ok: false, message: "You are not in a team." };
    if (team.ownerPlayerId !== getPlayerId(owner))
        return { ok: false, message: "Only the owner can change team settings." };
    if (enabled) {
        const ownerSlot = state.plots.playerToSlot[team.ownerPlayerId];
        if (!ownerSlot)
            return { ok: false, message: "The owner needs an assigned plot first." };
        team.personalPlotSlotIds ?? (team.personalPlotSlotIds = {});
        for (const memberId of team.memberPlayerIds) {
            if (memberId === team.ownerPlayerId)
                continue;
            suspendMemberPersonalPlot(team, memberId);
        }
        const ownerSlotObj = state.plots.slots[ownerSlot];
        if (ownerSlotObj)
            ownerSlotObj.occupiedByPlayerId = team.ownerPlayerId;
    }
    else {
        for (const memberId of team.memberPlayerIds) {
            restoreMemberPersonalPlot(memberId, team.personalPlotSlotIds?.[memberId]);
        }
    }
    team.teamPlotEnabled = enabled;
    savePlots();
    saveTeams();
    reconcileAllPlotState(enabled ? "team_plot_enabled" : "team_plot_disabled");
    return { ok: true, message: `Team plot ${enabled ? "enabled" : "disabled"}.` };
}
