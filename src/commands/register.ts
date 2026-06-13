import { CustomCommandRegistry } from "@minecraft/server";
import { registerMetaCommands } from "./register-meta";
import { registerFormsCommands } from "./register-forms";
import { registerShopsCommands } from "./register-shops";
import { registerSocialCommands } from "./register-social";
import { registerPlotsCommands } from "./register-plots";
import { registerTeamsCommands } from "./register-teams";
import { registerWarpsCommands } from "./register-warps";
import { registerWorldCommands } from "./register-world";
import { registerStatsCommands } from "./register-stats";
import { registerClaimsCommands } from "./register-claims";
import { registerRtpCommands } from "./register-rtp";
import { registerTeamHomesCommands } from "./register-team-homes";
import { registerRewardsReferralsCommands } from "./register-rewards-referrals";

export function registerCustomCommands(startupEvent: { customCommandRegistry: CustomCommandRegistry }): void {
  const registry = startupEvent.customCommandRegistry;
  registerMetaCommands(registry);
  registerFormsCommands(registry);
  registerShopsCommands(registry);
  registerSocialCommands(registry);
  registerPlotsCommands(registry);
  registerTeamsCommands(registry);
  registerWarpsCommands(registry);
  registerWorldCommands(registry);
  registerStatsCommands(registry);
  registerClaimsCommands(registry);
  registerRtpCommands(registry);
  registerTeamHomesCommands(registry);
  registerRewardsReferralsCommands(registry);
}
