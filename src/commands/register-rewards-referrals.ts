import { CommandPermissionLevel, CustomCommandParamType, CustomCommandRegistry, system } from "@minecraft/server";
import { runCustomReward } from "../custom-rewards";
import { redeemReferralCode } from "../referrals";
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
      description: "Redeem another player's referral code.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "code", type: CustomCommandParamType.String }],
    },
    "referrals",
    (player, code) => {
      const referralCode = String(code ?? "").trim();
      if (!referralCode) {
        system.run(async () => {
          const { showReferralMenu } = await import("../ui");
          showReferralMenu(player);
        });
        return ok("Opening referrals menu.");
      }
      return resultFrom(redeemReferralCode(player, referralCode));
    }
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
