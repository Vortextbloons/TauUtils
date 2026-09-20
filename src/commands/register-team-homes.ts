import { CustomCommandRegistry, system } from "@minecraft/server";
import { ok, requireFeatureResult, resultFrom } from "./helpers";
import { registerDescribedCommand } from "./descriptors";
import { commandOriginToPlayer } from "../storage";
import { deleteTeamHome, setTeamHome, teleportTeamHome } from "../team-homes";

export function registerTeamHomesCommands(registry: CustomCommandRegistry): void {
  registerDescribedCommand<[string | undefined]>(
    registry,
    "tau:teamsethome",
    (origin, name) => {
      const featErr = requireFeatureResult("teamHomes");
      if (featErr) return featErr;
      return resultFrom(setTeamHome(commandOriginToPlayer(origin)!, name));
    }
  );

  registerDescribedCommand<[string | undefined]>(
    registry,
    "tau:teamhome",
    (origin, name) => {
      const featErr = requireFeatureResult("teamHomes");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
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

  registerDescribedCommand<[string]>(
    registry,
    "tau:delteamhome",
    (origin, name) => {
      const featErr = requireFeatureResult("teamHomes");
      if (featErr) return featErr;
      return resultFrom(deleteTeamHome(commandOriginToPlayer(origin)!, name));
    }
  );
}
