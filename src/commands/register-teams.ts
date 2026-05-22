import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandRegistry,
  CustomCommandResult,
  system,
  world,
} from "@minecraft/server";
import { requirePlayerResult } from "./helpers";
import { commandOriginToPlayer, isFeatureEnabled, tell } from "../storage";
import { acceptTeamInvite, createTeam, disbandTeam, getPlayerTeam, inviteToTeam, joinTeam, kickFromTeam, leaveTeam } from "../teams";

export function registerTeamsCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand(
    {
      name: "tau:team",
      description: "Open team menu or manage teams.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "action", type: CustomCommandParamType.String },
        { name: "arg1", type: CustomCommandParamType.String },
      ],
    },
    (origin, action?: string, arg1?: string): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("teams")) return { status: 1, message: "Teams are disabled." };

      const act = String(action ?? "").trim().toLowerCase();
      if (!act || act === "ui" || act === "menu" || act === "open") {
        system.run(async () => {
          const { showTeamMenu } = await import("../ui");
          showTeamMenu(player);
        });
        return { status: 0, message: "Opening team menu." };
      }

      if (act === "create") {
        const result = createTeam(player, String(arg1 ?? "").trim());
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "join") {
        const result = joinTeam(player, String(arg1 ?? "").trim());
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "leave") {
        const result = leaveTeam(player);
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "accept") {
        const result = acceptTeamInvite(player, String(arg1 ?? "").trim());
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "invite") {
        const team = getPlayerTeam(player);
        if (!team) return { status: 1, message: "You are not in a team." };
        const targetName = String(arg1 ?? "").trim();
        if (!targetName) return { status: 1, message: "Usage: /tau:team invite <player>" };
        const target = world.getAllPlayers().find((p) => p.name.toLowerCase() === targetName.toLowerCase());
        if (!target) return { status: 1, message: `Player "${targetName}" not online.` };
        const result = inviteToTeam(player, target);
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "kick") {
        const team = getPlayerTeam(player);
        if (!team) return { status: 1, message: "You are not in a team." };
        const targetName = String(arg1 ?? "").trim();
        if (!targetName) return { status: 1, message: "Usage: /tau:team kick <player>" };
        const target = world.getAllPlayers().find((p) => p.name.toLowerCase() === targetName.toLowerCase());
        if (!target) return { status: 1, message: `Player "${targetName}" not online.` };
        const result = kickFromTeam(player, target);
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "disband") {
        const result = disbandTeam(player);
        return { status: result.ok ? 0 : 1, message: result.message };
      }

      return { status: 1, message: "Actions: ui, create, join, leave, accept, invite, kick, disband" };
    }
  );
}
