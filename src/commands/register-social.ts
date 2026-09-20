import {
  CustomCommandRegistry,
  system,
} from "@minecraft/server";
import { fail, ok, requireFeatureResult, resultFrom } from "./helpers";
import { registerDescribedCommand } from "./descriptors";
import { commandOriginToPlayer, getOnlinePlayerByName, tell } from "../storage";
import { acceptTpaRequest, cancelOutgoingTpaRequest, createTpaRequest, deleteHome, denyTpaRequest, payPlayer, setHome, teleportHome } from "../social";

export function registerSocialCommands(registry: CustomCommandRegistry): void {
  registerDescribedCommand<[string | undefined]>(
    registry,
    "tau:tpa",
    (origin, target) => {
      const featErr = requireFeatureResult("tpa");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
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
      return resultFrom(result);
    }
  );

  registerDescribedCommand<[string | undefined]>(
    registry,
    "tau:tpaccept",
    (origin, requestId) => {
      const featErr = requireFeatureResult("tpa");
      if (featErr) return featErr;
      return resultFrom(acceptTpaRequest(commandOriginToPlayer(origin)!, requestId ? String(requestId) : undefined));
    }
  );

  registerDescribedCommand<[string | undefined]>(
    registry,
    "tau:tpdeny",
    (origin, requestId) => {
      const featErr = requireFeatureResult("tpa");
      if (featErr) return featErr;
      return resultFrom(denyTpaRequest(commandOriginToPlayer(origin)!, requestId ? String(requestId) : undefined));
    }
  );

  registerDescribedCommand(
    registry,
    "tau:tpacancel",
    (origin, requestId) => {
      const featErr = requireFeatureResult("tpa");
      if (featErr) return featErr;
      return resultFrom(cancelOutgoingTpaRequest(commandOriginToPlayer(origin)!, String(requestId ?? "").trim()));
    }
  );

  registerDescribedCommand<[string | undefined]>(
    registry,
    "tau:sethome",
    (origin, name) => {
      const featErr = requireFeatureResult("homes");
      if (featErr) return featErr;
      return resultFrom(setHome(commandOriginToPlayer(origin)!, name));
    }
  );

  registerDescribedCommand<[string | undefined]>(
    registry,
    "tau:home",
    (origin, name) => {
      const featErr = requireFeatureResult("homes");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
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

  registerDescribedCommand<[string]>(
    registry,
    "tau:delhome",
    (origin, name) => {
      const featErr = requireFeatureResult("homes");
      if (featErr) return featErr;
      return resultFrom(deleteHome(commandOriginToPlayer(origin)!, name));
    }
  );

  registerDescribedCommand<[string | undefined, string | undefined]>(
    registry,
    "tau:pay",
    (origin, target, amount) => {
      const featErr = requireFeatureResult("pay");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
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

  registerDescribedCommand(
    registry,
    "tau:settings",
    (origin) => {
      const featErr = requireFeatureResult("playerConfig");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
      system.run(async () => {
        const { showPlayerSettingsMenu } = await import("../ui");
        showPlayerSettingsMenu(player);
      });
      return ok("Opening player settings.");
    }
  );
}
