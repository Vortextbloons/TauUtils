import { CustomCommandRegistry, CustomCommandResult, system } from "@minecraft/server";
import { registerDescribedCommand } from "./descriptors";
import { commandOriginToPlayer, isFeatureEnabled } from "../storage";

export function registerClaimsCommands(registry: CustomCommandRegistry): void {
  registerDescribedCommand(registry, "tau:claim", (origin): CustomCommandResult => {
    const player = commandOriginToPlayer(origin)!;
    if (!isFeatureEnabled("claims")) return { status: 1, message: "Claims are disabled." };
    system.run(async () => (await import("../ui")).showClaimMenu(player));
    return { status: 0, message: "Opening claims menu." };
  });

  registerDescribedCommand(registry, "tau:claims", (origin): CustomCommandResult => {
    const player = commandOriginToPlayer(origin)!;
    system.run(async () => (await import("../ui")).showClaimsAdminMenu(player));
    return { status: 0, message: "Opening claims admin menu." };
  });
}
