import { Player, system, CustomCommandResult } from "@minecraft/server";
import { commandOriginToPlayer, isFeatureEnabled, isOperator } from "../storage";

export function requirePlayer(origin: { sourceEntity?: import("@minecraft/server").Entity; initiator?: import("@minecraft/server").Entity }): Player | undefined {
  return commandOriginToPlayer(origin);
}

export function requirePlayerResult(origin: { sourceEntity?: import("@minecraft/server").Entity; initiator?: import("@minecraft/server").Entity }): CustomCommandResult | undefined {
  const player = commandOriginToPlayer(origin);
  if (!player) return { status: 1, message: "This command can only be used by a player." };
  return undefined;
}

export function requireFeatureResult(feature: string): CustomCommandResult | undefined {
  if (!isFeatureEnabled(feature as any)) return { status: 1, message: `${feature.charAt(0).toUpperCase() + feature.slice(1)} is disabled.` };
  return undefined;
}

export function requireOperatorResult(player: Player | undefined): CustomCommandResult | undefined {
  if (!player || !isOperator(player)) return { status: 1, message: "Operator required." };
  return undefined;
}

export function checkCommandConditions(origin: any, ...checks: Array<() => CustomCommandResult | undefined>): CustomCommandResult | undefined {
  for (const check of checks) {
    const result = check();
    if (result) return result;
  }
  return undefined;
}

export function deferPlayerUi(player: Player, run: () => void | Promise<void>): void {
  system.run(async () => {
    try {
      await run();
    } catch {
      // player may have left
    }
  });
}
