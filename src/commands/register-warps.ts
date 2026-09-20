import {
  CustomCommandRegistry,
  CustomCommandResult,
  system,
} from "@minecraft/server";
import { requireOperatorResult } from "./helpers";
import { registerDescribedCommand } from "./descriptors";
import { commandOriginToPlayer, isFeatureEnabled, tell } from "../storage";
import { listVisibleWarps } from "../warps";

export function registerWarpsCommands(registry: CustomCommandRegistry): void {
  registerDescribedCommand(
    registry,
    "tau:warpsadmin",
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
      if (!isFeatureEnabled("warps")) return { status: 1, message: "Warps are disabled." };
      system.run(async () => {
        const { showWarpAdminMenu } = await import("../ui");
        showWarpAdminMenu(player);
      });
      return { status: 0, message: "Opening warp admin menu." };
    }
  );

  registerDescribedCommand(
    registry,
    "tau:warp",
    (origin, warpName?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("warps")) return { status: 1, message: "Warps are disabled." };
      const name = String(warpName ?? "").trim();
      if (!name) {
        system.run(async () => {
          const { showWarpMenu } = await import("../ui");
          showWarpMenu(player);
        });
        return { status: 0, message: "Opening warp menu." };
      }
      const warp = listVisibleWarps(player).find((entry) => entry.id === name.toLowerCase() || entry.name.toLowerCase() === name.toLowerCase());
      if (!warp) return { status: 1, message: `Warp "${name}" not found.` };
      system.run(async () => {
        const { teleportToWarp } = await import("../warps");
        const result = teleportToWarp(player, warp.id);
        tell(player, result.message);
      });
      return { status: 0, message: `Teleporting to ${warp.name}.` };
    }
  );
}
