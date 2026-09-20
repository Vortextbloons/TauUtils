import { Player, CustomCommandResult } from "@minecraft/server";
import { isFeatureEnabled, isOperator } from "../storage";
import type { ConfigStore } from "../types";

type FeatureName = keyof ConfigStore["features"];

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
