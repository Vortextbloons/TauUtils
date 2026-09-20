import { CustomCommandRegistry, CustomCommandResult, system } from "@minecraft/server";
import { requireOperatorResult } from "./helpers";
import { registerDescribedCommand } from "./descriptors";
import { commandOriginToPlayer, isFeatureEnabled, tell } from "../storage";
import { randomTeleport } from "../rtp";

export function registerRtpCommands(registry: CustomCommandRegistry): void {
  registerDescribedCommand(registry, "tau:rtp", (origin, region?: string): CustomCommandResult => {
    const player = commandOriginToPlayer(origin)!;
    if (!isFeatureEnabled("rtp")) return { status: 1, message: "RTP is disabled." };
    system.run(async () => {
      const result = randomTeleport(player, String(region ?? "").trim() || undefined);
      if (result.needsSelection) (await import("../ui")).showRtpMenu(player);
      else tell(player, result.message);
    });
    return { status: 0, message: "Starting RTP." };
  });

  registerDescribedCommand(registry, "tau:rtpadmin", (origin): CustomCommandResult => {
    const player = commandOriginToPlayer(origin)!;
    const opErr = requireOperatorResult(player);
    if (opErr) return opErr;
    system.run(async () => (await import("../ui")).showRtpAdminMenu(player));
    return { status: 0, message: "Opening RTP admin menu." };
  });
}
