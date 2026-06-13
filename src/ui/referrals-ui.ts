import { Player } from "@minecraft/server";
import { getOrCreateReferralRecord, getTopReferralRows, redeemReferralCode } from "../referrals";
import { isFeatureEnabled, isOperator, saveReferrals, state, tell } from "../storage";
import { ICONS } from "../types";
import { TauUi } from "./tau-ui";

function parseRewardIds(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function showReferralAdminMenu(player: Player): Promise<void> {
  if (!isOperator(player)) {
    tell(player, "Operator required.");
    return;
  }
  while (true) {
    if (!isOperator(player)) {
      tell(player, "Operator required.");
      return;
    }
    const cfg = state.referrals.config;
    const maxLabel = cfg.maxReferralsPerPlayer > 0 ? String(cfg.maxReferralsPerPlayer) : "Unlimited";
    const cooldownLabel = cfg.cooldownSeconds > 0 ? `${cfg.cooldownSeconds}s` : "None";
    const response = await TauUi.action("Referral Admin")
      .body(`Enabled: ${cfg.enabled ? "On" : "Off"}\nMode: ${cfg.allowMultipleRedemptions ? "multiple codes" : "one code only"}\nMax redemptions/player: ${maxLabel}\nCooldown: ${cooldownLabel}\nReferee rewards: ${cfg.refereeRewardIds.join(", ") || "none"}\nReferrer rewards: ${cfg.referrerRewardIds.join(", ") || "none"}`)
      .button("toggle", `Enabled: ${cfg.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("multiple", `Redeem mode: ${cfg.allowMultipleRedemptions ? "Many" : "One"}`, { iconPath: ICONS.settings })
      .button("rewards", "Reward IDs", { iconPath: ICONS.shop })
      .button("broadcast", `Broadcast: ${cfg.broadcastMessage ? "On" : "Off"}`, { iconPath: ICONS.menu })
      .button("top", "Top Referrers", { iconPath: ICONS.rank })
      .button("recent", "Recent Redemptions", { iconPath: ICONS.menu })
      .button("customRewards", "Custom Rewards", { iconPath: ICONS.utility })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "toggle") cfg.enabled = !cfg.enabled;
    else if (response.id === "multiple") cfg.allowMultipleRedemptions = !cfg.allowMultipleRedemptions;
    else if (response.id === "broadcast") cfg.broadcastMessage = !cfg.broadcastMessage;
    else if (response.id === "rewards") {
      const result = await TauUi.modal("Referral Rewards")
        .text("referee", "Player entering code reward IDs", { placeholder: "referral_bonus", defaultValue: cfg.refereeRewardIds.join(",") })
        .text("referrer", "Code owner reward IDs", { placeholder: "referral_bonus", defaultValue: cfg.referrerRewardIds.join(",") })
        .text("maxReferrals", "Max redemptions per player (0 = unlimited)", { placeholder: "0 = unlimited", defaultValue: String(cfg.maxReferralsPerPlayer) })
        .text("cooldownSeconds", "Cooldown seconds (0 = none)", { placeholder: "0 = none", defaultValue: String(cfg.cooldownSeconds) })
        .text("history", "Max redemption history", { placeholder: "500", defaultValue: String(cfg.maxRedemptionHistory) })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      cfg.refereeRewardIds = parseRewardIds(result.values.referee);
      cfg.referrerRewardIds = parseRewardIds(result.values.referrer);
      cfg.maxReferralsPerPlayer = Math.max(0, Math.floor(Number(result.values.maxReferrals) || 0));
      cfg.cooldownSeconds = Math.max(0, Math.floor(Number(result.values.cooldownSeconds) || 0));
      const maxHistory = Math.floor(Number(result.values.history));
      cfg.maxRedemptionHistory = Number.isFinite(maxHistory) ? Math.max(1, maxHistory) : 500;
      state.referrals.redemptions = state.referrals.redemptions.slice(0, cfg.maxRedemptionHistory);
    } else if (response.id === "top") {
      await TauUi.action("Top Referrers").body(getTopReferralRows(10).join("\n") || "No referrals yet.").button("back", "Back", { iconPath: ICONS.back }).show(player);
      continue;
    } else if (response.id === "recent") {
      const rows = state.referrals.redemptions.slice(0, 10).map((entry) => `${entry.refereeName} -> ${entry.referrerName} (${entry.code})`);
      await TauUi.action("Recent Referrals").body(rows.join("\n") || "No redemptions yet.").button("back", "Back", { iconPath: ICONS.back }).show(player);
      continue;
    } else if (response.id === "customRewards") {
      const { showCustomRewardsAdminMenu } = await import("./custom-rewards-ui");
      await showCustomRewardsAdminMenu(player);
      continue;
    }
    saveReferrals();
  }
}

export async function showReferralMenu(player: Player): Promise<void> {
  if (!isFeatureEnabled("referrals")) {
    tell(player, "Referrals are disabled.");
    return;
  }
  while (true) {
    const record = getOrCreateReferralRecord(player);
    const response = await TauUi.action("Referrals")
      .body(`Your code: §e${record.code}§r\nSuccessful referrals: ${record.referralCount ?? 0}`)
      .button("redeem", "Enter Referral Code", { iconPath: ICONS.confirm })
      .button("admin", "Admin Settings", { iconPath: ICONS.settings })
      .button("close", "Close", { iconPath: ICONS.cancel })
      .show(player);
    if (response.canceled || response.id === "close") return;
    if (response.id === "redeem") {
      const result = await TauUi.modal("Enter Referral Code").text("code", "6 digit code", { placeholder: "123456" }).submitButton("Redeem").show(player);
      if (result.canceled) continue;
      tell(player, redeemReferralCode(player, String(result.values.code ?? "")).message);
      continue;
    }
    if (response.id === "admin") {
      await showReferralAdminMenu(player);
      continue;
    }
  }
}

export { showReferralAdminMenu };
