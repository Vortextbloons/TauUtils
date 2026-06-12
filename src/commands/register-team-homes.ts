import { CommandPermissionLevel, CustomCommandParamType, CustomCommandRegistry, system } from "@minecraft/server";
import { ok, registerPlayerCommand, resultFrom, tell } from "./helpers";
import { deleteTeamHome, getPlayerTeam, listTeamHomeNames, setTeamHome, summarizeTeamHomes, teleportTeamHome } from "../team-homes";

export function registerTeamHomesCommands(registry: CustomCommandRegistry): void {
  registerPlayerCommand<[string | undefined]>(
    registry,
    {
      name: "tau:teamsethome",
      description: "Set a team home at your current location.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    "teamHomes",
    (player, name) => resultFrom(setTeamHome(player, name))
  );

  registerPlayerCommand<[string | undefined]>(
    registry,
    {
      name: "tau:teamhome",
      description: "Teleport to a team home or open team home UI.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    "teamHomes",
    (player, name) => {
      const homeName = String(name ?? "").trim();
      if (!homeName) {
        system.run(async () => {
          const { showTeamHomesMenu } = await import("../ui");
          showTeamHomesMenu(player);
        });
        return ok("Opening team homes menu.");
      }
      return resultFrom(teleportTeamHome(player, homeName));
    }
  );

  registerPlayerCommand<[string]>(
    registry,
    {
      name: "tau:delteamhome",
      description: "Delete a team home.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    "teamHomes",
    (player, name) => resultFrom(deleteTeamHome(player, name))
  );

  registerPlayerCommand(
    registry,
    {
      name: "tau:teamhomes",
      description: "List your team's homes.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    "teamHomes",
    (player) => {
      const team = getPlayerTeam(player);
      if (!team) {
        tell(player, "You are not in a team.");
        return ok("You are not in a team.");
      }
      const names = listTeamHomeNames(team);
      if (names.length === 0) {
        tell(player, `Team ${team.name} has no team homes set.`);
        return ok("Listed team homes.");
      }
      tell(player, summarizeTeamHomes(team));
      for (const name of names) tell(player, `  - ${name}`);
      return ok("Listed team homes.");
    }
  );
}
