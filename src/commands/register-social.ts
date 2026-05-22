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
import { acceptTpaRequest, createTpaRequest, deleteHome, denyTpaRequest, listHomes, payPlayer, setHome, teleportHome } from "../social";

export function registerSocialCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand(
    {
      name: "tau:tpa",
      description: "Send a teleport request to a player.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "target", type: CustomCommandParamType.String }],
    },
    (origin, target?: string): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("tpa")) return { status: 1, message: "TPA is disabled." };

      const targetName = String(target ?? "").trim();
      if (!targetName) {
        system.run(async () => {
          const { showTpaMenu } = await import("../ui");
          showTpaMenu(player);
        });
        return { status: 0, message: "Opening TPA menu." };
      }

      const online = world.getAllPlayers().find((p) => p.name.toLowerCase() === targetName.toLowerCase());
      if (!online) return { status: 1, message: `Player "${targetName}" is not online.` };
      const result = createTpaRequest(player, online);
      if (result.ok) {
        tell(online, `§e${player.name} sent you a TPA request. Use /tau:tpaccept or /tau:tpdeny.`);
      }
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:tpaccept",
      description: "Accept latest TPA request.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("tpa")) return { status: 1, message: "TPA is disabled." };
      const result = acceptTpaRequest(player);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:tpdeny",
      description: "Deny latest TPA request.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("tpa")) return { status: 1, message: "TPA is disabled." };
      const result = denyTpaRequest(player);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:sethome",
      description: "Set a named home.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin, name?: string): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("homes")) return { status: 1, message: "Homes are disabled." };
      const result = setHome(player, name);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:home",
      description: "Teleport to a home or open home UI.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin, name?: string): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("homes")) return { status: 1, message: "Homes are disabled." };
      const homeName = String(name ?? "").trim();
      if (!homeName) {
        system.run(async () => {
          const { showHomesMenu } = await import("../ui");
          showHomesMenu(player);
        });
        return { status: 0, message: "Opening homes menu." };
      }
      const result = teleportHome(player, homeName);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:delhome",
      description: "Delete a named home.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin, name: string): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("homes")) return { status: 1, message: "Homes are disabled." };
      const result = deleteHome(player, name);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:homes",
      description: "List your homes.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("homes")) return { status: 1, message: "Homes are disabled." };
      const homes = listHomes(player);
      if (homes.length === 0) return { status: 0, message: "No homes set." };
      for (const home of homes) tell(player, `- ${home}`);
      return { status: 0, message: `Listed ${homes.length} homes.` };
    }
  );

  registry.registerCommand(
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
    (origin, target?: string, amount?: string): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("pay")) return { status: 1, message: "Pay is disabled." };

      const targetName = String(target ?? "").trim();
      if (!targetName) {
        system.run(async () => {
          const { showPayMenu } = await import("../ui");
          showPayMenu(player);
        });
        return { status: 0, message: "Opening pay menu." };
      }
      const online = world.getAllPlayers().find((p) => p.name.toLowerCase() === targetName.toLowerCase());
      if (!online) return { status: 1, message: `Player "${targetName}" is not online.` };
      const parsed = Number(String(amount ?? "").trim());
      if (!Number.isFinite(parsed)) return { status: 1, message: "Usage: /tau:pay <player> <amount>" };
      const result = payPlayer(player, online, parsed);
      if (result.ok) {
        tell(online, `§aYou received a payment from ${player.name}.`);
      }
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:settings",
      description: "Open player social settings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("playerConfig")) return { status: 1, message: "Player config is disabled." };
      system.run(async () => {
        const { showPlayerSettingsMenu } = await import("../ui");
        showPlayerSettingsMenu(player);
      });
      return { status: 0, message: "Opening player settings." };
    }
  );
}
