import { CommandPermissionLevel, CustomCommandRegistry, CustomCommandResult, system } from "@minecraft/server";
import { requirePlayerResult } from "./helpers";
import { commandOriginToPlayer, isFeatureEnabled } from "../storage";

export function registerClaimsCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand({ name: "tau:claim", description: "Open your claims menu.", cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any }, (origin): CustomCommandResult => {
    const err = requirePlayerResult(origin);
    if (err) return err;
    const player = commandOriginToPlayer(origin)!;
    if (!isFeatureEnabled("claims")) return { status: 1, message: "Claims are disabled." };
    system.run(async () => (await import("../ui")).showClaimMenu(player));
    return { status: 0, message: "Opening claims menu." };
  });

  registry.registerCommand({ name: "tau:claims", description: "Open claims admin menu.", cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any }, (origin): CustomCommandResult => {
    const err = requirePlayerResult(origin);
    if (err) return err;
    const player = commandOriginToPlayer(origin)!;
    system.run(async () => (await import("../ui")).showClaimsAdminMenu(player));
    return { status: 0, message: "Opening claims admin menu." };
  });
}
