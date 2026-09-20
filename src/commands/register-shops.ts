import {
  CustomCommandRegistry,
  system,
} from "@minecraft/server";
import { ok, requireFeatureResult, requireOperatorResult } from "./helpers";
import { registerDescribedCommand } from "./descriptors";
import { commandOriginToPlayer, tell } from "../storage";

export function registerShopsCommands(registry: CustomCommandRegistry): void {
  registerDescribedCommand<[string]>(
    registry,
    "tau:shop",
    (origin, profileId) => {
      const featErr = requireFeatureResult("shops");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
      const id = String(profileId ?? "").trim() || "default";
      system.run(async () => {
        const { openShopProfile } = await import("../shop");
        await openShopProfile(player, id);
      });
      return ok(`Opening shop profile ${id}.`);
    }
  );

  registerDescribedCommand(
    registry,
    "tau:myshop",
    (origin) => {
      const featErr = requireFeatureResult("playerShops");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
      system.run(async () => {
        const { openMyPlayerShop } = await import("../player-shops");
        await openMyPlayerShop(player);
      });
      return ok("Opening your player shop.");
    }
  );

  registerDescribedCommand(
    registry,
    "tau:market",
    (origin) => {
      const featErr = requireFeatureResult("playerShops");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
      system.run(async () => {
        const { openPlayerMarketplace } = await import("../player-shops");
        await openPlayerMarketplace(player);
      });
      return ok("Opening player marketplace.");
    }
  );

  registerDescribedCommand(
    registry,
    "tau:shopadmin",
    (origin) => {
      const featErr = requireFeatureResult("playerShops");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
      system.run(async () => {
        const { openPlayerShopAdmin } = await import("../player-shops");
        await openPlayerShopAdmin(player);
      });
      return ok("Opening player shop admin settings.");
    }
  );

  registerDescribedCommand(
    registry,
    "tau:shopclaim",
    (origin) => {
      const featErr = requireFeatureResult("playerShops");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
      system.run(async () => {
        const { claimPlayerShopEarnings } = await import("../player-shops");
        const result = claimPlayerShopEarnings(player);
        tell(player, result.ok ? result.message : `§e${result.message}`);
      });
      return ok("Claiming player-shop earnings.");
    }
  );
}
