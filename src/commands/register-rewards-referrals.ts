import { CommandPermissionLevel, CustomCommandParamType, CustomCommandRegistry, system } from "@minecraft/server";
import { runCustomReward } from "../custom-rewards";
import { getOrCreateReferralRecord, redeemReferralCode } from "../referrals";
import { tell } from "../storage";
import { ok, registerPlayerCommand, resultFrom } from "./helpers";

export function registerRewardsReferralsCommands(registry: CustomCommandRegistry): void {
  registerPlayerCommand<[string | undefined]>(
    registry,
    {
      name: "tau:reward",
      description: "Run a custom reward you have permission to use.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "id", type: CustomCommandParamType.String }],
    },
    "customRewards",
    (player, id) => {
      const rewardId = String(id ?? "").trim();
      if (!rewardId) {
        system.run(async () => {
          const { showCustomRewardsAdminMenu } = await import("../ui");
          showCustomRewardsAdminMenu(player);
        });
        return ok("Opening custom rewards menu.");
      }
      return resultFrom(runCustomReward(player, rewardId));
    }
  );

  registerPlayerCommand<[string | undefined]>(
    registry,
    {
      name: "tau:referral",
      description: "Show your referral code.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "code", type: CustomCommandParamType.String }],
    },
    "referrals",
    (player, code) => {
      const referralCode = String(code ?? "").trim();
      if (referralCode) return resultFrom(redeemReferralCode(player, referralCode));
      const record = getOrCreateReferralRecord(player);
      tell(player, `§aYour referral code: §e${record.code}`);
      tell(player, `§7Successful referrals: ${record.referralCount ?? 0}`);
      return ok(`Your referral code is ${record.code}.`);
    }
  );

  registerPlayerCommand<[string]>(
    registry,
    {
      name: "tau:refer",
      description: "Redeem another player's referral code.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "code", type: CustomCommandParamType.String }],
    },
    "referrals",
    (player, code) => resultFrom(redeemReferralCode(player, code))
  );

  registerPlayerCommand(
    registry,
    {
      name: "tau:referrals",
      description: "Open referral admin/player menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    "referrals",
    (player) => {
      system.run(async () => {
        const { showReferralMenu } = await import("../ui");
        showReferralMenu(player);
      });
      return ok("Opening referrals menu.");
    }
  );
}
