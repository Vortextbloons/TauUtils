import { Player, world } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS } from "../../types";
import { getPlayerId, isOperator, state, tell } from "../../storage";
import { createTeam, disbandTeam, getPlayerTeam, getTeamSummary, joinTeam, kickFromTeam, leaveTeam, listTeams, setTeamFriendlyFire, setTeamPlotEnabled } from "../../teams";
import { createWarp, deleteWarp, listWarps, setWarpLocation, teleportToWarp } from "../../warps";
import { showTeamInviteCenter, showPendingTeamInvites } from "./combat-admin";

export async function showTeamMenu(player: Player) {
  while (true) {
    const team = getPlayerTeam(player);
    const playerId = getPlayerId(player);
    const invitedTeams = listTeams().filter((entry) => entry.invitedPlayerIds.includes(playerId));
    const form = TauUi.action("§aTeams§r").body(team ? `§7Your team: §f${getTeamSummary(team)}` : "§7You are not in a team.§r");

    if (team) {
      form
        .button("inviteCenter", "Invite Center", { iconPath: ICONS.binding })
        .button("teamMembers", "Team Members", { iconPath: ICONS.menu })
        .button("teamSettings", "Team Settings", { iconPath: ICONS.settings })
        .button("leaveTeam", "Leave Team", { iconPath: ICONS.delete })
        .button("teamList", "Team List", { iconPath: ICONS.sidebar })
        .button("back", "Back", { iconPath: ICONS.back });
    } else {
      form
        .button("createTeam", "Create Team", { iconPath: ICONS.confirm })
        .button("joinTeam", "Join Team", { iconPath: ICONS.menu })
        .button("pendingInvites", invitedTeams.length > 0 ? `Pending Invites (${invitedTeams.length})` : "Pending Invites", { iconPath: ICONS.binding })
        .button("teamList", "Team List", { iconPath: ICONS.sidebar })
        .button("back", "Back", { iconPath: ICONS.back });
    }

    const response = await form.show(player);
    if (response.canceled) return;

    if (team) {
      if (response.id === "inviteCenter") {
        await showTeamInviteCenter(player);
        continue;
      }
      if (response.id === "teamMembers") {
        const members = team.memberPlayerIds
          .map((memberId) => world.getAllPlayers().find((p) => getPlayerId(p) === memberId)?.name ?? memberId)
          .slice(0, 20);
        for (const member of members) tell(player, `§7- §e${member}`);
        continue;
      }
      if (response.id === "teamSettings") {
        const sub = TauUi.action("Team Settings")
          .body(`§7Friendly fire: §f${team.friendlyFire ? "On" : "Off"}\n§7Team plot: §f${team.teamPlotEnabled ? "On" : "Off"}`)
          .button("friendlyFire", `Friendly Fire: ${team.friendlyFire ? "On" : "Off"}`, { iconPath: ICONS.settings })
          .button("teamPlot", `Team Plot: ${team.teamPlotEnabled ? "On" : "Off"}`, { iconPath: ICONS.sidebar })
          .button("kickMember", "Kick Member", { iconPath: ICONS.delete })
          .button("disbandTeam", "Disband Team", { iconPath: ICONS.delete })
          .button("back", "Back", { iconPath: ICONS.back });
        const subResp = await sub.show(player);
        if (subResp.canceled || subResp.id === "back") continue;
        if (subResp.id === "friendlyFire") {
          tell(player, setTeamFriendlyFire(player, !team.friendlyFire).message);
          continue;
        }
        if (subResp.id === "teamPlot") {
          tell(player, setTeamPlotEnabled(player, !team.teamPlotEnabled).message);
          continue;
        }
        if (subResp.id === "kickMember") {
          const online = world.getAllPlayers().filter((p) => p.id !== player.id && team.memberPlayerIds.includes(getPlayerId(p)));
          if (online.length === 0) {
            tell(player, "No online members available.");
            continue;
          }
          const pick = TauUi.action<{ index: number }>("Kick Member").body("Select a member to kick.");
          online.forEach((p, i) => pick.button("member", p.name, { iconPath: ICONS.delete, value: { index: i } }));
          pick.button("back", "Back", { iconPath: ICONS.back });
          const picked = await pick.show(player);
          if (picked.canceled || picked.id === "back" || !picked.value) continue;
          tell(player, kickFromTeam(player, online[picked.value.index]).message);
          continue;
        }
        if (subResp.id === "disbandTeam") {
          tell(player, disbandTeam(player).message);
          continue;
        }
        continue;
      }
      if (response.id === "leaveTeam") {
        tell(player, leaveTeam(player).message);
        continue;
      }
      if (response.id === "teamList") {
        const teams = listTeams();
        if (teams.length === 0) {
          tell(player, "No teams exist yet.");
          continue;
        }
        const lines = teams.slice(0, 20).map((teamEntry) => getTeamSummary(teamEntry));
        for (const line of lines) tell(player, line);
        continue;
      }
      if (response.id === "back") return;
      return;
    }

    if (response.id === "createTeam") {
      const result = await TauUi.modal("Create Team").text("name", "Team name", { placeholder: "My Team" }).text("tag", "Tag", { placeholder: "MT" }).submitButton("Create").show(player);
      if (result.canceled) continue;
      tell(player, createTeam(player, String(result.values.name ?? ""), String(result.values.tag ?? "")).message);
      continue;
    }
    if (response.id === "joinTeam") {
      const teams = listTeams();
      if (teams.length === 0) {
        tell(player, "No teams exist yet.");
        continue;
      }
      const pick = TauUi.action<{ index: number }>("Join Team").body("Select a team you were invited to.");
      teams.forEach((teamEntry, i) => pick.button("team", getTeamSummary(teamEntry), { iconPath: ICONS.menu, value: { index: i } }));
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back" || !picked.value) continue;
      tell(player, joinTeam(player, teams[picked.value.index].id).message);
      continue;
    }
    if (response.id === "pendingInvites") {
      if (invitedTeams.length === 0) {
        tell(player, "No pending team invites.");
        continue;
      }
      await showPendingTeamInvites(player);
      continue;
    }
    if (response.id === "teamList") {
      const teams = listTeams();
      if (teams.length === 0) {
        tell(player, "No teams exist yet.");
        continue;
      }
      const lines = teams.slice(0, 20).map((teamEntry) => getTeamSummary(teamEntry));
      for (const line of lines) tell(player, line);
      continue;
    }
    if (response.id === "back") return;
  }
}

export async function showWarpMenu(player: Player) {
  if (!state.warps.config.enabled) {
    tell(player, "Warps are disabled.");
    return;
  }
  while (true) {
    const warps = listWarps();
    const form = TauUi.action("§dWarps§r")
      .body("§7Teleport to admin-managed warp points.§r")
      .button("list", "Warp List", { iconPath: ICONS.sidebar })
      .button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;
    if (warps.length === 0) {
      tell(player, "No warps available.");
      continue;
    }

    const pick = TauUi.action<{ index: number }>("Warp List").body("Select a warp.");
    warps.forEach((warp, i) => pick.button("warp", `${warp.category}: ${warp.name}`, { iconPath: ICONS.sidebar, value: { index: i } }));
    pick.button("back", "Back", { iconPath: ICONS.back });
    const picked = await pick.show(player);
    if (picked.canceled || picked.id === "back" || !picked.value) continue;
    const warp = warps[picked.value.index];
    tell(player, teleportToWarp(player, warp.id).message);
  }
}

export async function showWarpAdminMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to manage warps.");
    return;
  }
  while (true) {
    const warps = listWarps();
    const form = TauUi.action("Warp Admin")
      .body("Manage cross-dimension server warps.")
      .button("create", "Create Warp", { iconPath: ICONS.confirm })
      .button("setLocation", "Set Warp Location", { iconPath: ICONS.edit })
      .button("deleteWarp", "Delete Warp", { iconPath: ICONS.delete })
      .button("list", "Warp List", { iconPath: ICONS.sidebar })
      .button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "create") {
      const result = await TauUi.modal("Create Warp").text("name", "Warp name", { placeholder: "spawn" }).text("category", "Category", { placeholder: "spawn" }).submitButton("Create").show(player);
      if (result.canceled) continue;
      tell(player, createWarp(player, String(result.values.name ?? ""), String(result.values.category ?? "")).message);
      continue;
    }

    if (warps.length === 0) {
      tell(player, "No warps available.");
      continue;
    }

    const pick = TauUi.action<{ index: number }>(response.id === "setLocation" ? "Set Warp Location" : "Delete Warp").body("Select a warp.");
    warps.forEach((warp, i) => pick.button("warp", `${warp.category}: ${warp.name}`, { iconPath: ICONS.sidebar, value: { index: i } }));
    pick.button("back", "Back", { iconPath: ICONS.back });
    const picked = await pick.show(player);
    if (picked.canceled || picked.id === "back" || !picked.value) continue;
    const warp = warps[picked.value.index];
    if (response.id === "setLocation") tell(player, setWarpLocation(player, warp.id).message);
    if (response.id === "deleteWarp") tell(player, deleteWarp(warp.id).message);
    if (response.id === "list") {
      tell(player, `${warp.name} @ ${warp.dimensionId} (${warp.position.x}, ${warp.position.y}, ${warp.position.z})`);
    }
  }
}
