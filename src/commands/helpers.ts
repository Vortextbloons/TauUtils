import { Player, CustomCommandRegistry, CustomCommandResult } from "@minecraft/server";
import { commandOriginToPlayer, isFeatureEnabled, isOperator } from "../storage";
import type { ConfigStore } from "../types";

type CommandOrigin = { sourceEntity?: import("@minecraft/server").Entity; initiator?: import("@minecraft/server").Entity };
type CommandSpec = Parameters<CustomCommandRegistry["registerCommand"]>[0];
type CommandCallback = Parameters<CustomCommandRegistry["registerCommand"]>[1];
type FeatureName = keyof ConfigStore["features"];

export function requirePlayerResult(origin: CommandOrigin): CustomCommandResult | undefined {
  const player = commandOriginToPlayer(origin);
  if (!player) return { status: 1, message: "This command can only be used by a player." };
  return undefined;
}

export function requireFeatureResult(feature: FeatureName, label = feature): CustomCommandResult | undefined {
  if (!isFeatureEnabled(feature)) return { status: 1, message: `${String(label).charAt(0).toUpperCase() + String(label).slice(1)} is disabled.` };
  return undefined;
}

export function requireOperatorResult(player: Player | undefined): CustomCommandResult | undefined {
  if (!player || !isOperator(player)) return { status: 1, message: "Operator required." };
  return undefined;
}

export function ok(message: string): CustomCommandResult {
  return { status: 0, message };
}

export function fail(message: string): CustomCommandResult {
  return { status: 1, message };
}

export function resultFrom(result: { ok: boolean; message: string }): CustomCommandResult {
  return { status: result.ok ? 0 : 1, message: result.message };
}

export function registerPlayerCommand<TArgs extends unknown[]>(
  registry: CustomCommandRegistry,
  spec: CommandSpec,
  feature: FeatureName | undefined,
  handler: (player: Player, ...args: TArgs) => CustomCommandResult,
): void {
  const callback = ((origin: CommandOrigin, ...args: TArgs): CustomCommandResult => {
    const err = requirePlayerResult(origin) ?? (feature ? requireFeatureResult(feature) : undefined);
    if (err) return err;
    return handler(commandOriginToPlayer(origin)!, ...args);
  }) as CommandCallback;
  registry.registerCommand(spec, callback);
}
