import { CommandPermissionLevel, CustomCommandParamType, CustomCommandRegistry, system } from "@minecraft/server";
import { ok, registerPlayerCommand, resultFrom } from "./helpers";
import { deleteTeamHome, setTeamHome, teleportTeamHome } from "../team-homes";

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
}
