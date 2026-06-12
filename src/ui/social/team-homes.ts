import { Player, world } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS, type TeamDefinition } from "../../types";
import { getPlayerId, state, tell } from "../../storage";
import { deleteTeamHome, listTeamHomeNames, setTeamHome, teleportTeamHome } from "../../team-homes";
import { demoteTeamMember, getPlayerTeam, isTeamOwnerOrAdmin, promoteTeamMember } from "../../teams";

export async function showTeamHomesMenu(player: Player): Promise<void> {
  if (!state.teamHomes.config.enabled) {
    tell(player, "Team homes are disabled.");
    return;
  }
  while (true) {
    const team = getPlayerTeam(player);
    if (!team) {
      tell(player, "You are not in a team.");
      return;
    }
    const canMutate = isTeamOwnerOrAdmin(player, team);
    const names = listTeamHomeNames(team);

    const form = TauUi.action(`Team Homes: ${team.name}`).body(`Homes: ${names.length} / ${state.teamHomes.config.maxHomesPerTeam}`);

    if (canMutate) form.button("set", "Set Team Home", { iconPath: ICONS.confirm });
    form.button("tp", "Teleport to Team Home", { iconPath: ICONS.sidebar });
    if (canMutate) form.button("delete", "Delete Team Home", { iconPath: ICONS.delete });
    if (team.ownerPlayerId === getPlayerId(player)) form.button("roles", "Manage Roles", { iconPath: ICONS.rank });
    form.button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "set" && canMutate) {
      const result = await TauUi.modal("Set Team Home").text("name", "Home name", { placeholder: "home" }).submitButton("Set").show(player);
      if (result.canceled) continue;
      tell(player, setTeamHome(player, String(result.values.name ?? "home")).message);
      continue;
    }

    if (response.id === "tp") {
      if (names.length === 0) {
        tell(player, "No team homes set.");
        continue;
      }
      const target = await pickTeamHome(player, team, "Teleport to Team Home", names);
      if (target) tell(player, teleportTeamHome(player, target).message);
      continue;
    }

    if (response.id === "delete" && canMutate) {
      if (names.length === 0) {
        tell(player, "No team homes set.");
        continue;
      }
      const target = await pickTeamHome(player, team, "Delete Team Home", names);
      if (target) tell(player, deleteTeamHome(player, target).message);
      continue;
    }

    if (response.id === "roles" && team.ownerPlayerId === getPlayerId(player)) {
      await showTeamRolesMenu(player, team);
      continue;
    }
  }
}

async function pickTeamHome(player: Player, _team: TeamDefinition, title: string, names: string[]): Promise<string | undefined> {
  let page = 0;
  const pageSize = 12;
  while (true) {
    const slice = TauUi.paginate(names, page, pageSize);
    const form = TauUi.action<number>(`${title} ${slice.page + 1}/${slice.pageCount}`);
    for (let i = 0; i < slice.items.length; i++) {
      const absoluteIndex = slice.startIndex + i;
      form.button("home", slice.items[absoluteIndex], { iconPath: ICONS.menu, value: absoluteIndex });
    }
    if (slice.hasPrevious) form.button("previous", "Previous", { iconPath: ICONS.back });
    if (slice.hasNext) form.button("next", "Next", { iconPath: ICONS.back });
    form.button("back", "Back", { iconPath: ICONS.back });

    const result = await form.show(player);
    if (result.canceled || result.id === "back") return undefined;
    if (result.id === "previous" && slice.hasPrevious) {
      page--;
      continue;
    }
    if (result.id === "next" && slice.hasNext) {
      page++;
      continue;
    }
    if (result.id === "home" && result.value !== undefined) return names[result.value];
  }
}

function roleLabel(team: TeamDefinition, playerId: string): string {
  if (team.ownerPlayerId === playerId) return "Owner";
  if (team.adminPlayerIds?.includes(playerId)) return "Admin";
  return "Member";
}

export async function showTeamRolesMenu(player: Player, team: TeamDefinition): Promise<void> {
  while (true) {
    const memberEntries = team.memberPlayerIds.map((memberId) => {
      const online = world.getAllPlayers().find((p) => getPlayerId(p) === memberId);
      return { id: memberId, name: online?.name ?? memberId, online: !!online };
    });

    const form = TauUi.action<string>(`Roles: ${team.name}`).body("Select a member to change their role.");

    for (const entry of memberEntries) {
      form.button("member", `${entry.name} - ${roleLabel(team, entry.id)}${entry.online ? "" : " (offline)"}`, { iconPath: ICONS.rank, value: entry.id });
    }
    form.button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id !== "member" || !response.value) continue;

    const targetId = response.value;
    const currentRole = roleLabel(team, targetId);

    if (targetId === team.ownerPlayerId) {
      tell(player, "The owner cannot be promoted or demoted.");
      continue;
    }

    const isAdmin = team.adminPlayerIds?.includes(targetId) ?? false;
    const targetOnline = world.getAllPlayers().find((p) => getPlayerId(p) === targetId);
    const targetName = targetOnline?.name ?? targetId;

    if (isAdmin) {
      const pick = await TauUi.action(`Demote ${targetName}?`)
        .body(`${targetName} is currently an admin. Demote to member?`)
        .button("demote", "Demote to member", { iconPath: ICONS.delete })
        .button("back", "Back", { iconPath: ICONS.back })
        .show(player);
      if (pick.canceled || pick.id === "back" || pick.id !== "demote") continue;
      if (!targetOnline) {
        tell(player, `${targetName} must be online to change roles.`);
        continue;
      }
      tell(player, demoteTeamMember(player, targetOnline.name).message);
    } else {
      const pick = await TauUi.action(`Promote ${targetName}?`)
        .body(`${targetName} is currently ${currentRole.toLowerCase()}. Promote to admin? Admins can set and delete team homes.`)
        .button("promote", "Promote to admin", { iconPath: ICONS.confirm })
        .button("back", "Back", { iconPath: ICONS.back })
        .show(player);
      if (pick.canceled || pick.id === "back" || pick.id !== "promote") continue;
      if (!targetOnline) {
        tell(player, `${targetName} must be online to change roles.`);
        continue;
      }
      tell(player, promoteTeamMember(player, targetOnline.name).message);
    }
  }
}
