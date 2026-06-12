import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandRegistry,
  system,
} from "@minecraft/server";
import { ok, registerPlayerCommand, requireOperatorResult } from "./helpers";
import { tell } from "../storage";

export function registerShopsCommands(registry: CustomCommandRegistry): void {
  registerPlayerCommand<[string]>(
    registry,
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
    "shops",
    (player, profileId) => {
      const id = String(profileId ?? "").trim() || "default";
      system.run(async () => {
        const { openShopProfile } = await import("../shop");
        await openShopProfile(player, id);
      });
      return ok(`Opening shop profile ${id}.`);
    }
  );

  registerPlayerCommand(
    registry,
    {
      name: "tau:myshop",
      description: "Open your player shop manager.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    "shops",
    (player) => {
      system.run(async () => {
        const { openMyPlayerShop } = await import("../player-shops");
        await openMyPlayerShop(player);
      });
      return ok("Opening your player shop.");
    }
  );

  registerPlayerCommand(
    registry,
    {
      name: "tau:market",
      description: "Browse player marketplace listings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    "shops",
    (player) => {
      system.run(async () => {
        const { openPlayerMarketplace } = await import("../player-shops");
        await openPlayerMarketplace(player);
      });
      return ok("Opening player marketplace.");
    }
  );

  registerPlayerCommand(
    registry,
    {
      name: "tau:shopadmin",
      description: "Open player shop admin settings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    "shops",
    (player) => {
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
      system.run(async () => {
        const { openPlayerShopAdmin } = await import("../player-shops");
        await openPlayerShopAdmin(player);
      });
      return ok("Opening player shop admin settings.");
    }
  );

  registerPlayerCommand(
    registry,
    {
      name: "tau:shopclaim",
      description: "Claim offline player-shop earnings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    "shops",
    (player) => {
      system.run(async () => {
        const { claimPlayerShopEarnings } = await import("../player-shops");
        const result = claimPlayerShopEarnings(player);
        tell(player, result.ok ? result.message : `§e${result.message}`);
      });
      return ok("Claiming player-shop earnings.");
    }
  );
}
