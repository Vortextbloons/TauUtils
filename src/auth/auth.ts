import { Player } from "@minecraft/server";
import { hasPermission, isFeatureEnabled, isOperator } from "../storage";
import type { ConfigStore } from "../types";

export type AuthReason =
  | "ok"
  | "no-player"
  | "not-operator"
  | "no-permission"
  | "feature-disabled";

export type AuthResult = {
  ok: boolean;
  reason: AuthReason;
  message: string;
};

function capitalizeLabel(label: string): string {
  if (!label) return label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function requireOperator(player: Player | undefined): AuthResult {
  if (!player || !isOperator(player)) {
    return { ok: false, reason: "not-operator", message: "Operator required." };
  }
  return { ok: true, reason: "ok", message: "OK" };
}

export function requirePermission(player: Player | undefined, permission: string): AuthResult {
  if (!player) {
    return { ok: false, reason: "no-player", message: "Player required." };
  }
  const perm = String(permission ?? "").trim();
  if (!perm || !hasPermission(player, perm)) {
    return { ok: false, reason: "no-permission", message: `Missing permission "${perm}".` };
  }
  return { ok: true, reason: "ok", message: "OK" };
}

export function requireFeatureThenOperator(
  player: Player | undefined,
  feature: keyof ConfigStore["features"],
  label: string = String(feature),
): AuthResult {
  if (!isFeatureEnabled(feature)) {
    return { ok: false, reason: "feature-disabled", message: `${capitalizeLabel(label)} is disabled.` };
  }
  return requireOperator(player);
}
