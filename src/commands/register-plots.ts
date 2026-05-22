import {
  CommandPermissionLevel,
  CustomCommandRegistry,
  CustomCommandResult,
  system,
} from "@minecraft/server";
import { requirePlayerResult } from "./helpers";
import { commandOriginToPlayer, isFeatureEnabled } from "../storage";

export function registerPlotsCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand(
    {
      name: "tau:plot",
      description: "Open your plot info menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
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

  registry.registerCommand(
    {
      name: "tau:plots",
      description: "Open plot manager (admin).",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("plots")) return { status: 1, message: "Plots are disabled." };
      system.run(async () => {
        const { showPlotManager } = await import("../ui");
        showPlotManager(player);
      });
      return { status: 0, message: "Opening plot manager." };
    }
  );
}
