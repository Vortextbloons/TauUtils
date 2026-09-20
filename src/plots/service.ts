import { savePlots, state } from "../storage";
import { invalidatePlotCaches } from "./grid";
import type { PlotStore } from "../types";

// Domain commit for plot config mutations made by admin UI. Owns the
// save + cache-invalidation entry point so UI never assigns state directly.
export function commitPlotConfig(partial: Partial<Pick<PlotStore["config"], "enabled" | "saveIntervalTicks">>): { ok: boolean; message: string } {
  if (partial.enabled !== undefined) state.plots.config.enabled = partial.enabled;
  if (partial.saveIntervalTicks !== undefined) {
    state.plots.config.saveIntervalTicks = Math.max(1, Math.floor(partial.saveIntervalTicks));
  }
  invalidatePlotCaches();
  savePlots();
  return { ok: true, message: "Plot settings saved." };
}
