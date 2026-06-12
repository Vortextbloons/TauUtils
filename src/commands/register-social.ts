import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandRegistry,
  system,
} from "@minecraft/server";
import { fail, ok, registerPlayerCommand, resultFrom } from "./helpers";
import { getOnlinePlayerByName, tell } from "../storage";
import { acceptTpaRequest, createTpaRequest, deleteHome, denyTpaRequest, listHomes, payPlayer, setHome, teleportHome } from "../social";

export function registerSocialCommands(registry: CustomCommandRegistry): void {
  registerPlayerCommand<[string | undefined]>(
    registry,
    {
      name: "tau:tpa",
      description: "Send a teleport request to a player.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "target", type: CustomCommandParamType.String }],
    },
    "tpa",
    (player, target) => {
      const targetName = String(target ?? "").trim();
      if (!targetName) {
        system.run(async () => {
          const { showTpaMenu } = await import("../ui");
          showTpaMenu(player);
        });
        return ok("Opening TPA menu.");
      }

      const online = getOnlinePlayerByName(targetName);
      if (!online) return fail(`Player "${targetName}" is not online.`);
      const result = createTpaRequest(player, online);
      if (result.ok) {
        tell(online, `§e${player.name} sent you a TPA request. Use /tau:tpaccept or /tau:tpdeny.`);
      }
      return resultFrom(result);
    }
  );

  registerPlayerCommand(
    registry,
    {
      name: "tau:tpaccept",
      description: "Accept latest TPA request.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    "tpa",
    (player) => resultFrom(acceptTpaRequest(player))
  );

  registerPlayerCommand(
    registry,
    {
      name: "tau:tpdeny",
      description: "Deny latest TPA request.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    "tpa",
    (player) => resultFrom(denyTpaRequest(player))
  );

  registerPlayerCommand<[string | undefined]>(
    registry,
    {
      name: "tau:sethome",
      description: "Set a named home.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    "homes",
    (player, name) => resultFrom(setHome(player, name))
  );

  registerPlayerCommand<[string | undefined]>(
    registry,
    {
      name: "tau:home",
      description: "Teleport to a home or open home UI.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    "homes",
    (player, name) => {
      const homeName = String(name ?? "").trim();
      if (!homeName) {
        system.run(async () => {
          const { showHomesMenu } = await import("../ui");
          showHomesMenu(player);
        });
        return ok("Opening homes menu.");
      }
      return resultFrom(teleportHome(player, homeName));
    }
  );

  registerPlayerCommand<[string]>(
    registry,
    {
      name: "tau:delhome",
      description: "Delete a named home.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    "homes",
    (player, name) => resultFrom(deleteHome(player, name))
  );

  registerPlayerCommand(
    registry,
    {
      name: "tau:homes",
      description: "List your homes.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    "homes",
    (player) => {
      const homes = listHomes(player);
      if (homes.length === 0) return ok("No homes set.");
      for (const home of homes) tell(player, `- ${home}`);
      return ok(`Listed ${homes.length} homes.`);
    }
  );

  registerPlayerCommand<[string | undefined, string | undefined]>(
    registry,
    {
      name: "tau:pay",
      description: "Pay another player.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "target", type: CustomCommandParamType.String },
        { name: "amount", type: CustomCommandParamType.String },
      ],
    },
    "pay",
    (player, target, amount) => {
      const targetName = String(target ?? "").trim();
      if (!targetName) {
        system.run(async () => {
          const { showPayMenu } = await import("../ui");
          showPayMenu(player);
        });
        return ok("Opening pay menu.");
      }
      const online = getOnlinePlayerByName(targetName);
      if (!online) return fail(`Player "${targetName}" is not online.`);
      const parsed = Number(String(amount ?? "").trim());
      if (!Number.isFinite(parsed)) return fail("Usage: /tau:pay <player> <amount>");
      const result = payPlayer(player, online, parsed);
      if (result.ok) {
        tell(online, `§aYou received a payment from ${player.name}.`);
      }
      return resultFrom(result);
    }
  );

  registerPlayerCommand(
    registry,
    {
      name: "tau:settings",
      description: "Open player social settings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    "playerConfig",
    (player) => {
      system.run(async () => {
        const { showPlayerSettingsMenu } = await import("../ui");
        showPlayerSettingsMenu(player);
      });
      return ok("Opening player settings.");
    }
  );
}
