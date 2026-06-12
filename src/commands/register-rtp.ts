import { CommandPermissionLevel, CustomCommandParamType, CustomCommandRegistry, CustomCommandResult, system } from "@minecraft/server";
import { requireOperatorResult, requirePlayerResult } from "./helpers";
import { commandOriginToPlayer, isFeatureEnabled, tell } from "../storage";
import { randomTeleport } from "../rtp";

export function registerRtpCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand({ name: "tau:rtp", description: "Random teleport.", cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any, optionalParameters: [{ name: "region", type: CustomCommandParamType.String }] }, (origin, region?: string): CustomCommandResult => {
    const err = requirePlayerResult(origin);
    if (err) return err;
    const player = commandOriginToPlayer(origin)!;
    if (!isFeatureEnabled("rtp")) return { status: 1, message: "RTP is disabled." };
    system.run(async () => {
      const result = randomTeleport(player, String(region ?? "").trim() || undefined);
      if (result.needsSelection) (await import("../ui")).showRtpMenu(player);
      else tell(player, result.message);
    });
    return { status: 0, message: "Starting RTP." };
  });

  registry.registerCommand({ name: "tau:rtpadmin", description: "Open RTP admin menu.", cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any }, (origin): CustomCommandResult => {
    const err = requirePlayerResult(origin);
    if (err) return err;
    const player = commandOriginToPlayer(origin)!;
    const opErr = requireOperatorResult(player);
    if (opErr) return opErr;
    system.run(async () => (await import("../ui")).showRtpAdminMenu(player));
    return { status: 0, message: "Opening RTP admin menu." };
  });
}
