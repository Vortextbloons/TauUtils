import { processCombatTags } from "../combat";
import { processClaims } from "../claims";
import { processCustomAreas } from "../custom-areas";
import { processGenerators } from "../generators";
import { isFeatureEnabled, state } from "../storage";
import { registerBackgroundTask } from "../scheduler";
import { registerLifecycleEvents } from "./lifecycle";
import { getCachedPlayers } from "./player-cache";
import { initializeOnlinePlayersAfterReload, processStatsSampleBackgroundTick, registerPlayerLifecycleEvents } from "./player-lifecycle";
import { processModerationSnapshotBackgroundTick, registerModerationEvents } from "./moderation-events";
import { registerInteractionEvents } from "./interaction-events";
import { registerCombatEvents } from "./combat-events";
import { processPlotAutoSaveBackgroundTick, processPlotBuildQueueBackgroundTick, processPlotTitleBackgroundTick } from "./plot-events";

export { getCachedPlayers, initializeOnlinePlayersAfterReload };

export function registerEventInterceptors(): void {
  registerLifecycleEvents();

  // Subscription order matches the original events-core.ts: each world/system
  // event has exactly one subscriber, so cross-module order is preserved here.
  registerPlayerLifecycleEvents();
  registerModerationEvents();
  registerInteractionEvents();
  registerCombatEvents();

  // Background-task registration order matches the original, with the same
  // intervals, gates, and stagger offsets. Tasks never share a tick except by
  // design (offsets 1/3/4/6/7/9/11/13/15/17/18); dispatch order is tick-driven.
  registerBackgroundTask("combat-tags", 20, () => {
    processCombatTags(getCachedPlayers());
  }, 1);
  // processCombatTags cancels its own mid-flight job on disable (combat core).
  // The claims/custom-areas/generators ticks below have no mid-flight cancel:
  // drain-one-cycle is acceptable because each job is budget-bounded and
  // re-checks its feature/config gate on every yielded iteration.

  registerBackgroundTask("custom-areas", () => Math.max(1, state.customAreas.config.checkIntervalTicks), () => {
    processCustomAreas(getCachedPlayers());
  }, 4);

  registerBackgroundTask("claims", () => Math.max(1, state.claims.config.checkIntervalTicks), () => {
    processClaims(getCachedPlayers());
  }, 6);

  registerBackgroundTask("stats-sample", 20, processStatsSampleBackgroundTick, 7);

  registerBackgroundTask("plot-auto-save", () => Math.max(1, state.plots.config.saveIntervalTicks), processPlotAutoSaveBackgroundTick, 11);

  registerBackgroundTask("moderation-snapshot", 40, processModerationSnapshotBackgroundTick, 17);

  registerBackgroundTask("plot-enter-title", 20, processPlotTitleBackgroundTick, 13);

  registerBackgroundTask("plot-build-queue", 20, processPlotBuildQueueBackgroundTick, 15);

  registerBackgroundTask("generators", 20, () => {
    if (!isFeatureEnabled("generators")) return;
    processGenerators(getCachedPlayers());
  }, 18);
}
