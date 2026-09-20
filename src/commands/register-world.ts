import {
  CustomCommandRegistry,
  CustomCommandResult,
  system,
} from "@minecraft/server";
import { requireOperatorResult } from "./helpers";
import { registerDescribedCommand } from "./descriptors";
import { commandOriginToPlayer, isFeatureEnabled, tell } from "../storage";
import { pruneData, tellPruneResult } from "../prune";
import { listCrateIds } from "../crates";
import { listTauItemIds } from "../tau-items";

export function registerWorldCommands(registry: CustomCommandRegistry): void {
  registerDescribedCommand(
    registry,
    "tau:generatorsadmin",
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
      if (!isFeatureEnabled("generators")) return { status: 1, message: "Generators are disabled." };
      system.run(async () => {
        const { showGeneratorAdminMenu } = await import("../ui");
        showGeneratorAdminMenu(player);
      });
      return { status: 0, message: "Opening generator admin menu." };
    }
  );

  registerDescribedCommand(
    registry,
    "tau:crate",
    (origin, action?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("crates")) return { status: 1, message: "Crates are disabled." };
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;

      const actionKey = String(action ?? "").trim().toLowerCase();
      if (actionKey === "list") {
        const ids = listCrateIds();
        if (ids.length === 0) return { status: 0, message: "No crates configured." };
        for (const id of ids) tell(player, `§7- §e${id}`);
        return { status: 0, message: `Listed ${ids.length} crate id(s).` };
      }

      system.run(async () => {
        const { showCrateAdminMenu } = await import("../ui");
        showCrateAdminMenu(player);
      });
      return { status: 0, message: "Opening crate admin." };
    }
  );

  registerDescribedCommand(
    registry,
    "tau:item",
    (origin, action?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("items")) return { status: 1, message: "TauItems are disabled." };
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;

      const actionKey = String(action ?? "").trim().toLowerCase();
      if (actionKey === "list") {
        const ids = listTauItemIds();
        if (ids.length === 0) return { status: 0, message: "No TauItems configured." };
        for (const id of ids) tell(player, `§7- §e${id}`);
        return { status: 0, message: `Listed ${ids.length} TauItem id(s).` };
      }

      system.run(async () => {
        const { showTauItemsAdminMenu } = await import("../ui");
        showTauItemsAdminMenu(player);
      });
      return { status: 0, message: "Opening TauItems admin." };
    }
  );

  registerDescribedCommand(
    registry,
    "tau:lootchests",
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
      if (!isFeatureEnabled("lootChests")) return { status: 1, message: "Loot chests are disabled." };
      system.run(async () => {
        const { showLootChestsAdminMenu } = await import("../ui");
        showLootChestsAdminMenu(player);
      });
      return { status: 0, message: "Opening loot chest admin menu." };
    }
  );

  registerDescribedCommand(
    registry,
    "tau:dev_icon",
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
      system.run(async () => {
        const { showIconDevMenu } = await import("../ui");
        showIconDevMenu(player);
      });
      return { status: 0, message: "Opening icon dev menu." };
    }
  );

  registerDescribedCommand(
    registry,
    "tau:prune",
    (origin, action?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
      if (!isFeatureEnabled("prune")) return { status: 1, message: "Prune is disabled." };

      const act = String(action ?? "").trim().toLowerCase();
      if (!act || act === "ui" || act === "menu" || act === "open") {
        system.run(async () => {
          const { showPruneDataMenu } = await import("../ui");
          showPruneDataMenu(player);
        });
        return { status: 0, message: "Opening prune menu." };
      }

      if (act === "dry" || act === "preview") {
        const result = pruneData(true);
        tellPruneResult(player, result, true);
        return { status: 0, message: `Previewed ${result.removed} removals.` };
      }

      if (act === "run" || act === "execute") {
        const result = pruneData(false);
        tellPruneResult(player, result, false);
        return { status: 0, message: `Pruned ${result.removed} entries.` };
      }

      return { status: 1, message: "Actions: ui, dry, run" };
    }
  );
}
