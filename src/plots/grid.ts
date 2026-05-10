import { Player, Vector3, world } from "@minecraft/server";
import { STORAGE_KEYS, type PlotSlot, type PlotSize } from "../types";
import { savePlots, saveTeams, state, tell } from "../storage";

function roundVec(v: Vector3) {
  return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}

const MAX_PLOT_COUNT = 5000;
export const MAX_FILL_VOLUME = 32768;
export const MAX_FILL_SPAN = 16;
export const BUILD_PROXIMITY_RADIUS = 128;

function clampCount(n: number): number {
  return Math.max(1, Math.min(MAX_PLOT_COUNT, Math.floor(n)));
}

export function slotName(index: number): string {
  return `plot_${index + 1}`;
}

export function parseSlotIndex(slotId: string): number {
  const match = /^plot_(\d+)$/.exec(slotId);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

type PlotLayoutOptions = {
  count?: number;
  size?: Partial<PlotSize>;
  spacing?: number;
};

let cachedPlotSlots: PlotSlot[] | undefined;
let cachedPlotSlotsSource: Record<string, PlotSlot> | undefined;

export function getPlotSlots(): PlotSlot[] {
  if (cachedPlotSlotsSource === state.plots.slots && cachedPlotSlots) return cachedPlotSlots;
  cachedPlotSlotsSource = state.plots.slots;
  cachedPlotSlots = Object.values(state.plots.slots).slice().sort((a, b) => {
    const ai = parseSlotIndex(a.id);
    const bi = parseSlotIndex(b.id);
    return ai - bi || a.id.localeCompare(b.id);
  });
  return cachedPlotSlots;
}

function resolvePlotLayoutOptions(options?: PlotLayoutOptions) {
  const current = state.plots.config;
  return {
    count: options?.count !== undefined ? clampCount(options.count) : current.activePlotCount,
    size: {
      x: options?.size?.x !== undefined ? Math.max(1, Math.floor(options.size.x)) : current.size.x,
      y: options?.size?.y !== undefined ? Math.max(1, Math.floor(options.size.y)) : current.size.y,
      z: options?.size?.z !== undefined ? Math.max(1, Math.floor(options.size.z)) : current.size.z,
    },
    spacing: options?.spacing !== undefined ? Math.max(0, Math.floor(options.spacing)) : current.spacing,
  };
}

function intersects(a: PlotSlot, b: PlotSlot): boolean {
  return !(
    a.max.x < b.min.x || a.min.x > b.max.x ||
    a.max.y < b.min.y || a.min.y > b.max.y ||
    a.max.z < b.min.z || a.min.z > b.max.z
  );
}

export function getDimension() {
  return world.getDimension(state.plots.config.dimensionId);
}

export function invalidatePlotSlotCache() {
  cachedPlotSlots = undefined;
  cachedPlotSlotsSource = undefined;
}

export function setPlotOriginFromPlayer(player: Player) {
  state.plots.config.origin = roundVec(player.location);
  state.plots.config.dimensionId = player.dimension.id;
  invalidatePlotSlotCache();
  savePlots();
}

export function setPlotCount(count: number) {
  state.plots.config.activePlotCount = clampCount(count);
  invalidatePlotSlotCache();
  savePlots();
}

export function setPlotSize(x: number, y: number, z: number) {
  state.plots.config.size = {
    x: Math.max(1, Math.floor(x)),
    y: Math.max(1, Math.floor(y)),
    z: Math.max(1, Math.floor(z)),
  };
  invalidatePlotSlotCache();
  savePlots();
}

export function setPlotSpacing(spacing: number) {
  state.plots.config.spacing = Math.max(0, Math.floor(spacing));
  invalidatePlotSlotCache();
  savePlots();
}

export function buildManualGridSlots(options?: PlotLayoutOptions): { ok: boolean; message: string } {
  const origin = state.plots.config.origin;
  if (!origin) return { ok: false, message: "Set plot origin first." };

  const cfg = resolvePlotLayoutOptions(options);
  const slots: Record<string, PlotSlot> = {};
  const width = cfg.size.x + cfg.spacing;
  const depth = cfg.size.z + cfg.spacing;

  const perRow = Math.max(1, Math.ceil(Math.sqrt(cfg.count)));
  for (let i = 0; i < cfg.count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const min = {
      x: origin.x + col * width,
      y: origin.y,
      z: origin.z + row * depth,
    };
    const max = {
      x: min.x + cfg.size.x - 1,
      y: min.y + cfg.size.y - 1,
      z: min.z + cfg.size.z - 1,
    };
    const id = slotName(i);
    const previous = state.plots.slots[id];
    slots[id] = {
      id,
      min,
      max,
      manual: previous?.manual ?? false,
      occupiedByPlayerId: previous?.occupiedByPlayerId,
    };
  }

  state.plots.slots = slots;
  const nextPlayerToSlot: Record<string, string> = {};
  for (const slot of Object.values(slots)) {
    if (slot.occupiedByPlayerId) {
      nextPlayerToSlot[slot.occupiedByPlayerId] = slot.id;
    }
  }
  state.plots.playerToSlot = nextPlayerToSlot;

  for (const [playerId, snapshot] of Object.entries(state.plots.snapshots)) {
    if (!snapshot || (snapshot.slotId && !slots[snapshot.slotId])) {
      delete state.plots.snapshots[playerId];
    }
  }

  invalidatePlotSlotCache();
  savePlots();
  return { ok: true, message: `Built ${cfg.count} plots.` };
}

export function getPlotSlotsList(): PlotSlot[] {
  return getPlotSlots();
}

export function setSlotManualBounds(slotId: string, cornerA: Vector3, cornerB: Vector3): boolean {
  const slot = state.plots.slots[slotId];
  if (!slot) return false;
  const a = roundVec(cornerA);
  const b = roundVec(cornerB);
  slot.min = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    z: Math.min(a.z, b.z),
  };
  slot.max = {
    x: Math.max(a.x, b.x),
    y: Math.max(a.y, b.y),
    z: Math.max(a.z, b.z),
  };
  slot.manual = true;
  invalidatePlotSlotCache();
  savePlots();
  return true;
}

export function validatePlotLayout(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const slots = getPlotSlots();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.min.x > slot.max.x || slot.min.y > slot.max.y || slot.min.z > slot.max.z) {
      errors.push(`${slot.id}: invalid bounds`);
    }
    for (let j = i + 1; j < slots.length; j++) {
      const other = slots[j];
      if (intersects(slot, other)) {
        errors.push(`${slot.id} overlaps ${other.id}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function getPlotStatusLines(): string[] {
  const lines: string[] = [];
  const slots = getPlotSlots().slice().sort((a, b) => {
    const ai = parseSlotIndex(a.id);
    const bi = parseSlotIndex(b.id);
    return ai - bi || a.id.localeCompare(b.id);
  });
  for (const slot of slots) {
    const owner = slot.occupiedByPlayerId ?? "free";
    const mode = slot.manual ? "manual" : "grid";
    lines.push(`${slot.id}: ${owner} (${mode})`);
  }
  return lines;
}
