import {
  CustomCommandRegistry,
  CustomCommandResult,
  system,
} from "@minecraft/server";
import { requireOperatorResult } from "./helpers";
import { registerDescribedCommand } from "./descriptors";
import { commandOriginToPlayer, isFeatureEnabled } from "../storage";

export function registerPlotsCommands(registry: CustomCommandRegistry): void {
  registerDescribedCommand(
    registry,
    "tau:plot",
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("plots")) return { status: 1, message: "Plots are disabled." };
      if (!isFeatureEnabled("plotTp")) return { status: 1, message: "Plot teleport is disabled." };
      system.run(async () => {
        const { showPlotPlayerMenu } = await import("../ui");
        showPlotPlayerMenu(player);
      });
      return { status: 0, message: "Opening plot menu." };
    }
  );

  registerDescribedCommand(
    registry,
    "tau:plots",
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
      if (!isFeatureEnabled("plots")) return { status: 1, message: "Plots are disabled." };
      system.run(async () => {
        const { showPlotManager } = await import("../ui");
        showPlotManager(player);
      });
      return { status: 0, message: "Opening plot manager." };
    }
  );
}
