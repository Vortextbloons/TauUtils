import { CustomCommandRegistry, system } from "@minecraft/server";
import { runCustomReward } from "../custom-rewards";
import { redeemReferralCode } from "../referrals";
import { ok, requireFeatureResult, resultFrom } from "./helpers";
import { registerDescribedCommand } from "./descriptors";
import { commandOriginToPlayer } from "../storage";

export function registerRewardsReferralsCommands(registry: CustomCommandRegistry): void {
  registerDescribedCommand<[string | undefined]>(
    registry,
    "tau:reward",
    (origin, id) => {
      const featErr = requireFeatureResult("customRewards");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
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

  registerDescribedCommand<[string | undefined]>(
    registry,
    "tau:referral",
    (origin, code) => {
      const featErr = requireFeatureResult("referrals");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
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

  registerDescribedCommand(
    registry,
    "tau:referrals",
    (origin) => {
      const featErr = requireFeatureResult("referrals");
      if (featErr) return featErr;
      const player = commandOriginToPlayer(origin)!;
      system.run(async () => {
        const { showReferralMenu } = await import("../ui");
        showReferralMenu(player);
      });
      return ok("Opening referrals menu.");
    }
  );
}
