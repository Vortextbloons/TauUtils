import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandRegistry,
  CustomCommandResult,
  system,
} from "@minecraft/server";
import { requirePlayerResult, requireOperatorResult } from "./helpers";
import { commandOriginToPlayer, isFeatureEnabled, isOperator, tell } from "../storage";
import { listWarps } from "../warps";

export function registerWarpsCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand(
    {
      name: "tau:warps",
      description: "Open warp menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      if (!isFeatureEnabled("warps")) return { status: 1, message: "Warps are disabled." };
      system.run(async () => {
        const { showWarpMenu } = await import("../ui");
        showWarpMenu(player);
      });
      return { status: 0, message: "Opening warp menu." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:warpsadmin",
      description: "Open warp admin menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
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

  registry.registerCommand(
    {
      name: "tau:warp",
      description: "Teleport to a warp or open warp menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "warp", type: CustomCommandParamType.String }],
    },
    (origin, warpName?: string): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
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
      const warp = listWarps().find((entry) => entry.id === name.toLowerCase() || entry.name.toLowerCase() === name.toLowerCase());
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
