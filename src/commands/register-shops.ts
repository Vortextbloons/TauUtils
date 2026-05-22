import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandRegistry,
  CustomCommandResult,
  system,
} from "@minecraft/server";
import { requirePlayerResult, requireOperatorResult } from "./helpers";
import { commandOriginToPlayer, isFeatureEnabled, isOperator, tell } from "../storage";

export function registerShopsCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand(
    {
      name: "tau:shop",
      description: "Open a Tau shop profile.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [
        {
          name: "profile_id",
          type: CustomCommandParamType.String,
        },
      ],
    },
    (origin, profileId: string): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("shops")) {
        return { status: 1, message: "Shops are disabled." };
      }
      const id = String(profileId ?? "").trim() || "default";
      system.run(async () => {
        const { openShopProfile } = await import("../shop");
        await openShopProfile(player, id);
      });
      return { status: 0, message: `Opening shop profile ${id}.` };
    }
  );

  registry.registerCommand(
    {
      name: "tau:myshop",
      description: "Open your player shop manager.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("shops")) {
        return { status: 1, message: "Shops are disabled." };
      }
      system.run(async () => {
        const { openMyPlayerShop } = await import("../player-shops");
        await openMyPlayerShop(player);
      });
      return { status: 0, message: "Opening your player shop." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:market",
      description: "Browse player marketplace listings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("shops")) {
        return { status: 1, message: "Shops are disabled." };
      }
      system.run(async () => {
        const { openPlayerMarketplace } = await import("../player-shops");
        await openPlayerMarketplace(player);
      });
      return { status: 0, message: "Opening player marketplace." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:shopadmin",
      description: "Open player shop admin settings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("shops")) {
        return { status: 1, message: "Shops are disabled." };
      }
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
      system.run(async () => {
        const { openPlayerShopAdmin } = await import("../player-shops");
        await openPlayerShopAdmin(player);
      });
      return { status: 0, message: "Opening player shop admin settings." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:shopclaim",
      description: "Claim offline player-shop earnings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("shops")) {
        return { status: 1, message: "Shops are disabled." };
      }
      system.run(async () => {
        const { claimPlayerShopEarnings } = await import("../player-shops");
        const result = claimPlayerShopEarnings(player);
        tell(player, result.ok ? result.message : `§e${result.message}`);
      });
      return { status: 0, message: "Claiming player-shop earnings." };
    }
  );
}
