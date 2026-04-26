import { Player, Vector3, world } from "@minecraft/server";
import { STORAGE_KEYS, type PlacedGenerator, type PlotSnapshot, type PlotSlot, type PlotSize, type TeamDefinition } from "./tau-models";
import { getPlayerId, saveGenerators, savePlots, saveTeams, state, tell } from "./storage";
import { getPlayerTeam } from "./teams";

function roundVec(v: Vector3) {
  return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}

const MAX_PLOT_COUNT = 5000;
const MAX_FILL_VOLUME = 32768;
const MAX_FILL_SPAN = 16;
const BUILD_PROXIMITY_RADIUS = 128;

function clampCount(n: number): number {
  return Math.max(1, Math.min(MAX_PLOT_COUNT, Math.floor(n)));
}

function slotName(index: number): string {
  return `plot_${index + 1}`;
}

function parseSlotIndex(slotId: string): number {
  const match = /^plot_(\d+)$/.exec(slotId);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function reorderPlotSlots(): boolean {
  const orderedSlots = getPlotSlots().slice().sort((a, b) => parseSlotIndex(a.id) - parseSlotIndex(b.id) || a.id.localeCompare(b.id));
  if (orderedSlots.length === 0) return false;

  const nextSlots: Record<string, PlotSlot> = {};
  const slotRemap = new Map<string, string>();
  let changed = false;

  for (let index = 0; index < orderedSlots.length; index++) {
    const current = orderedSlots[index]!;
    const targetId = slotName(index);
    slotRemap.set(current.id, targetId);
    if (current.id !== targetId) changed = true;
    nextSlots[targetId] = { ...current, id: targetId };
  }

  if (!changed) return false;

  for (const slot of Object.values(nextSlots)) {
    if (slot.occupiedByPlayerId) {
      const remapped = state.plots.playerToSlot[slot.occupiedByPlayerId];
      if (remapped && slotRemap.get(remapped)) {
        slot.occupiedByPlayerId = slot.occupiedByPlayerId;
      }
    }
  }

  const nextPlayerToSlot: Record<string, string> = {};
  for (const [playerId, oldSlotId] of Object.entries(state.plots.playerToSlot)) {
    const remapped = slotRemap.get(oldSlotId);
    if (remapped) nextPlayerToSlot[playerId] = remapped;
  }

  const nextSnapshots: Record<string, PlotSnapshot> = {};
  for (const [playerId, snapshot] of Object.entries(state.plots.snapshots)) {
    const remappedSlotId = snapshot.slotId ? slotRemap.get(snapshot.slotId) : undefined;
    nextSnapshots[playerId] = remappedSlotId ? { ...snapshot, slotId: remappedSlotId } : { ...snapshot };
  }

  const nextTeamPlots = state.teams.teams;
  for (const team of Object.values(nextTeamPlots)) {
    if (!team.personalPlotSlotIds) continue;
    const remappedPersonal: Record<string, string> = {};
    for (const [memberId, oldSlotId] of Object.entries(team.personalPlotSlotIds)) {
      const remapped = slotRemap.get(oldSlotId);
      if (remapped) remappedPersonal[memberId] = remapped;
    }
    team.personalPlotSlotIds = remappedPersonal;
  }

  state.plots.slots = nextSlots;
  state.plots.playerToSlot = nextPlayerToSlot;
  state.plots.snapshots = nextSnapshots;
  cachedPlotSlots = undefined;
  cachedPlotSlotsSource = undefined;
  savePlots();
  saveTeams();
  return true;
}

type PlotLayoutOptions = {
  count?: number;
  size?: Partial<PlotSize>;
  spacing?: number;
};

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

export function setPlotOriginFromPlayer(player: Player) {
  state.plots.config.origin = roundVec(player.location);
  state.plots.config.dimensionId = player.dimension.id;
  savePlots();
}

export function setPlotCount(count: number) {
  state.plots.config.activePlotCount = clampCount(count);
  savePlots();
}

export function setPlotSize(x: number, y: number, z: number) {
  state.plots.config.size = {
    x: Math.max(1, Math.floor(x)),
    y: Math.max(1, Math.floor(y)),
    z: Math.max(1, Math.floor(z)),
  };
  savePlots();
}

export function setPlotSpacing(spacing: number) {
  state.plots.config.spacing = Math.max(0, Math.floor(spacing));
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

  cachedPlotSlots = undefined;
  cachedPlotSlotsSource = undefined;
  savePlots();
  return { ok: true, message: `Built ${cfg.count} plots.` };
}

type FillJob = {
  slotId: string;
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  block: string;
};

type SnapshotJob = {
  playerId: string;
  slotId: string;
  mode: "save" | "load";
  attempts: number;
  generators?: PlotSnapshot["generators"];
};

const fillQueue: FillJob[] = [];
let fillQueueCursor = 0;
const pendingJobCountsBySlot: Record<string, number> = {};
const completedSlots: Set<string> = new Set();
let buildSessionTotalSlots = 0;
const snapshotQueue: SnapshotJob[] = [];

let cachedPlotSlots: PlotSlot[] | undefined;
let cachedPlotSlotsSource: Record<string, PlotSlot> | undefined;

function getPlotSlots(): PlotSlot[] {
  if (cachedPlotSlotsSource === state.plots.slots && cachedPlotSlots) return cachedPlotSlots;
  cachedPlotSlotsSource = state.plots.slots;
  cachedPlotSlots = Object.values(state.plots.slots).slice().sort((a, b) => {
    const ai = parseSlotIndex(a.id);
    const bi = parseSlotIndex(b.id);
    return ai - bi || a.id.localeCompare(b.id);
  });
  return cachedPlotSlots;
}

export function getPlotSlotsList(): PlotSlot[] {
  return getPlotSlots();
}

function getTeamForPlayerId(playerId: string): TeamDefinition | undefined {
  const teamId = state.teams.playerTeamIds[playerId];
  if (!teamId) return undefined;
  return state.teams.teams[teamId];
}

function hasOnlinePlotAccess(ownerPlayerId: string, onlineIds: Set<string>): boolean {
  if (onlineIds.has(ownerPlayerId)) return true;
  const team = Object.values(state.teams.teams).find((entry) => entry.ownerPlayerId === ownerPlayerId && entry.teamPlotEnabled);
  if (!team) return false;
  return team.memberPlayerIds.some((memberId) => onlineIds.has(memberId));
}

function shouldSuspendTeamMemberPlot(playerId: string): boolean {
  const team = getTeamForPlayerId(playerId);
  return Boolean(team?.teamPlotEnabled && team.ownerPlayerId !== playerId);
}

function countGeneratorsInSlot(slot: PlotSlot): number {
  let count = 0;
  for (const generator of Object.values(state.generators.placed)) {
    if (isGeneratorInSlot(generator, slot)) count += 1;
  }
  return count;
}

function findOccupiedPlotSlotId(ownerPlayerId: string): string | undefined {
  let bestSlotId: string | undefined;
  let bestGeneratorCount = -1;

  for (const slot of getPlotSlots()) {
    if (slot.occupiedByPlayerId !== ownerPlayerId) continue;
    const generatorCount = countGeneratorsInSlot(slot);
    if (generatorCount > bestGeneratorCount) {
      bestGeneratorCount = generatorCount;
      bestSlotId = slot.id;
    }
  }

  return bestSlotId;
}

function resolveAuthoritativeOwnedSlotId(ownerPlayerId: string): string | undefined {
  if (shouldSuspendTeamMemberPlot(ownerPlayerId)) return undefined;

  const snapshotSlotId = state.plots.snapshots[ownerPlayerId]?.slotId;
  if (snapshotSlotId) {
    const snapshotSlot = state.plots.slots[snapshotSlotId];
    if (snapshotSlot && snapshotSlot.occupiedByPlayerId === ownerPlayerId) return snapshotSlotId;
  }

  const mappedSlotId = state.plots.playerToSlot[ownerPlayerId];
  if (mappedSlotId) {
    const mappedSlot = state.plots.slots[mappedSlotId];
    if (mappedSlot && mappedSlot.occupiedByPlayerId === ownerPlayerId) return mappedSlotId;
  }

  const occupiedSlotId = findOccupiedPlotSlotId(ownerPlayerId);
  if (occupiedSlotId) return occupiedSlotId;

  if (mappedSlotId) return mappedSlotId;
  if (snapshotSlotId) return snapshotSlotId;
  return undefined;
}

function repairOwnedPlotSlots(ownerPlayerId: string, authoritativeSlotId: string): boolean {
  let changed = false;
  for (const slot of getPlotSlots()) {
    if (slot.id === authoritativeSlotId) continue;
    if (slot.occupiedByPlayerId !== ownerPlayerId) continue;
    clearSlot(slot);
    slot.occupiedByPlayerId = undefined;
    changed = true;
  }

  const authoritativeSlot = state.plots.slots[authoritativeSlotId];
  if (authoritativeSlot && authoritativeSlot.occupiedByPlayerId !== ownerPlayerId) {
    authoritativeSlot.occupiedByPlayerId = ownerPlayerId;
    changed = true;
  }

  if (state.plots.playerToSlot[ownerPlayerId] !== authoritativeSlotId) {
    state.plots.playerToSlot[ownerPlayerId] = authoritativeSlotId;
    changed = true;
  }

  if (authoritativeSlot) {
    const saved = saveSlotSnapshot(authoritativeSlot, ownerPlayerId, captureSlotGenerators(authoritativeSlot, ownerPlayerId));
    changed = saved || changed;
  }

  return changed;
}

export function getPlotOwnerIdForPlayerId(playerId: string): string {
  const team = getTeamForPlayerId(playerId);
  if (team?.teamPlotEnabled) return team.ownerPlayerId;
  return playerId;
}

export function getAssignedSlotIdForOwner(ownerPlayerId: string): string | undefined {
  return resolveAuthoritativeOwnedSlotId(ownerPlayerId) ?? state.plots.playerToSlot[ownerPlayerId];
}

export function getAssignedSlotForOwner(ownerPlayerId: string): PlotSlot | undefined {
  const slotId = getAssignedSlotIdForOwner(ownerPlayerId);
  if (!slotId) return undefined;
  return state.plots.slots[slotId];
}

export function getAssignedSlotForPlayer(player: Player): PlotSlot | undefined {
  const ownerPlayerId = getPlotOwnerIdForPlayer(player);
  if (!ownerPlayerId) return undefined;
  return getAssignedSlotForOwner(ownerPlayerId);
}

export function reconcilePlotOwnershipData(): { ok: boolean; mappingsFixed: number; snapshotsFixed: number; generatorsFixed: number; message: string } {
  let mappingsFixed = 0;
  let snapshotsFixed = 0;
  let generatorsFixed = 0;

  const nextSnapshots: Record<string, PlotSnapshot> = {};
  for (const [playerId, snapshot] of Object.entries(state.plots.snapshots)) {
    const ownerPlayerId = getPlotOwnerIdForPlayerId(playerId);
    const current = nextSnapshots[ownerPlayerId];
    if (!current || (snapshot.savedAt ?? 0) >= (current.savedAt ?? 0)) {
      nextSnapshots[ownerPlayerId] = snapshot;
    }
    if (ownerPlayerId !== playerId) snapshotsFixed += 1;
  }
  state.plots.snapshots = nextSnapshots;

  const nextPlayerToSlot: Record<string, string> = {};
  const slots = getPlotSlots();

  for (const slot of slots) {
    const occupant = slot.occupiedByPlayerId;
    if (!occupant) continue;
    if (shouldSuspendTeamMemberPlot(occupant)) {
      if (!saveAndClearSlot(slot, occupant)) {
        snapshotQueue.push({ playerId: occupant, slotId: slot.id, mode: "save", attempts: 0, generators: captureSlotGenerators(slot, occupant) });
      }
      slot.occupiedByPlayerId = undefined;
      mappingsFixed += 1;
      continue;
    }
    const ownerPlayerId = getPlotOwnerIdForPlayerId(occupant);
    const authoritativeSlotId = resolveAuthoritativeOwnedSlotId(ownerPlayerId) ?? slot.id;
    if (slot.id !== authoritativeSlotId) {
      clearSlot(slot);
      slot.occupiedByPlayerId = undefined;
      mappingsFixed += 1;
      continue;
    }
    if (slot.occupiedByPlayerId !== ownerPlayerId) {
      slot.occupiedByPlayerId = ownerPlayerId;
      mappingsFixed += 1;
    }
    nextPlayerToSlot[ownerPlayerId] = slot.id;
  }

  for (const [playerId, slotId] of Object.entries(state.plots.playerToSlot)) {
    const slot = state.plots.slots[slotId];
    if (!slot) {
      mappingsFixed += 1;
      continue;
    }
    if (shouldSuspendTeamMemberPlot(playerId)) {
      if (!saveAndClearSlot(slot, playerId)) {
        snapshotQueue.push({ playerId, slotId: slot.id, mode: "save", attempts: 0, generators: captureSlotGenerators(slot, playerId) });
      }
      slot.occupiedByPlayerId = undefined;
      mappingsFixed += 1;
      delete state.plots.playerToSlot[playerId];
      continue;
    }
    const ownerPlayerId = getPlotOwnerIdForPlayerId(playerId);
    const authoritativeSlotId = resolveAuthoritativeOwnedSlotId(ownerPlayerId) ?? slotId;
    if (!nextPlayerToSlot[ownerPlayerId]) {
      nextPlayerToSlot[ownerPlayerId] = authoritativeSlotId;
    }
    if (nextPlayerToSlot[ownerPlayerId] !== authoritativeSlotId) {
      mappingsFixed += 1;
      nextPlayerToSlot[ownerPlayerId] = authoritativeSlotId;
    }
    if (slot.id !== authoritativeSlotId) {
      clearSlot(slot);
      slot.occupiedByPlayerId = undefined;
      mappingsFixed += 1;
      continue;
    }
    if (ownerPlayerId !== playerId) mappingsFixed += 1;
  }

  state.plots.playerToSlot = nextPlayerToSlot;

  for (const [ownerPlayerId, slotId] of Object.entries(nextPlayerToSlot)) {
    if (repairOwnedPlotSlots(ownerPlayerId, slotId)) mappingsFixed += 1;
  }

  for (const [ownerPlayerId, snapshot] of Object.entries(state.plots.snapshots)) {
    if (!snapshot.generators || snapshot.generators.length === 0) continue;
    for (const entry of snapshot.generators) {
      if (entry.ownerPlayerId === ownerPlayerId) continue;
      entry.ownerPlayerId = ownerPlayerId;
      generatorsFixed += 1;
    }
  }

  for (const placed of Object.values(state.generators.placed)) {
    const slot = getPlotForLocation({ x: placed.x, y: placed.y, z: placed.z });
    const ownerPlayerId = slot?.occupiedByPlayerId;
    if (!ownerPlayerId) continue;
    if (placed.ownerPlayerId === ownerPlayerId) continue;
    placed.ownerPlayerId = ownerPlayerId;
    generatorsFixed += 1;
  }

  if (mappingsFixed > 0 || snapshotsFixed > 0) savePlots();
  if (generatorsFixed > 0) saveGenerators();
  return {
    ok: true,
    mappingsFixed,
    snapshotsFixed,
    generatorsFixed,
    message: `Reconciled plots (mappings=${mappingsFixed}, snapshots=${snapshotsFixed}, generators=${generatorsFixed}).`,
  };
}

function reconcileTeamPlotSlots(): boolean {
  let changed = false;
  for (const team of Object.values(state.teams.teams)) {
    if (!team.teamPlotEnabled) continue;
    if (!team.personalPlotSlotIds) team.personalPlotSlotIds = {};
    const ownerSlotId = state.plots.playerToSlot[team.ownerPlayerId];
    if (!ownerSlotId) continue;
    const ownerSlot = state.plots.slots[ownerSlotId];
    if (ownerSlot && ownerSlot.occupiedByPlayerId !== team.ownerPlayerId) {
      ownerSlot.occupiedByPlayerId = team.ownerPlayerId;
      changed = true;
    }

    for (const memberId of team.memberPlayerIds) {
      if (memberId === team.ownerPlayerId) continue;
      const mappedSlotId = state.plots.playerToSlot[memberId];
      const savedSlotId = team.personalPlotSlotIds[memberId] ?? mappedSlotId;
      if (savedSlotId && team.personalPlotSlotIds[memberId] !== savedSlotId) {
        team.personalPlotSlotIds[memberId] = savedSlotId;
        changed = true;
      }

      if (mappedSlotId) {
        const mappedSlot = state.plots.slots[mappedSlotId];
        if (mappedSlot && mappedSlot.occupiedByPlayerId === memberId) {
          if (saveAndClearSlot(mappedSlot, memberId)) changed = true;
          mappedSlot.occupiedByPlayerId = undefined;
          changed = true;
        }
        delete state.plots.playerToSlot[memberId];
        changed = true;
      }

      const savedSlot = savedSlotId ? state.plots.slots[savedSlotId] : undefined;
      if (savedSlot && savedSlot.occupiedByPlayerId === memberId) {
        if (saveAndClearSlot(savedSlot, memberId)) changed = true;
        savedSlot.occupiedByPlayerId = undefined;
        changed = true;
      }
    }
  }

  if (changed) savePlots();
  return changed;
}

function canUsePlotCommandsNow(): boolean {
  try {
    const dim = getDimension();
    const origin = state.plots.config.origin ?? { x: 0, y: 0, z: 0 };
    const probe = dim.getBlock(origin);
    return Boolean(probe);
  } catch {
    return false;
  }
}

function runFillCommand(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }, block: string) {
  const dim = getDimension();
  dim.runCommand(`fill ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} ${block}`);
}

function getFillVolume(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): number {
  return (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
}

function splitFillJob(job: FillJob): [FillJob, FillJob] {
  const dx = job.max.x - job.min.x;
  const dy = job.max.y - job.min.y;
  const dz = job.max.z - job.min.z;
  if (dx >= dy && dx >= dz && dx > 0) {
    const mid = Math.floor((job.min.x + job.max.x) / 2);
    return [
      { ...job, max: { x: mid, y: job.max.y, z: job.max.z } },
      { ...job, min: { x: mid + 1, y: job.min.y, z: job.min.z } },
    ];
  }
  if (dy >= dx && dy >= dz && dy > 0) {
    const mid = Math.floor((job.min.y + job.max.y) / 2);
    return [
      { ...job, max: { x: job.max.x, y: mid, z: job.max.z } },
      { ...job, min: { x: job.min.x, y: mid + 1, z: job.min.z } },
    ];
  }
  const mid = Math.floor((job.min.z + job.max.z) / 2);
  return [
    { ...job, max: { x: job.max.x, y: job.max.y, z: mid } },
    { ...job, min: { x: job.min.x, y: job.min.y, z: mid + 1 } },
  ];
}

function shouldSplitFillJob(job: FillJob): boolean {
  const width = job.max.x - job.min.x + 1;
  const height = job.max.y - job.min.y + 1;
  const depth = job.max.z - job.min.z + 1;
  return width > MAX_FILL_SPAN || height > MAX_FILL_SPAN || depth > MAX_FILL_SPAN || getFillVolume(job.min, job.max) > MAX_FILL_VOLUME;
}

function enqueueFill(slotId: string, min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }, block: string): void {
  const job: FillJob = { slotId, min, max, block };
  if (shouldSplitFillJob(job)) {
    const [a, b] = splitFillJob(job);
    enqueueFill(a.slotId, a.min, a.max, a.block);
    enqueueFill(b.slotId, b.min, b.max, b.block);
    return;
  }

  fillQueue.push(job);
  pendingJobCountsBySlot[slotId] = (pendingJobCountsBySlot[slotId] ?? 0) + 1;
}

function distanceToBox(location: { x: number; y: number; z: number }, min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): number {
  const dx = location.x < min.x ? min.x - location.x : location.x > max.x ? location.x - max.x : 0;
  const dy = location.y < min.y ? min.y - location.y : location.y > max.y ? location.y - max.y : 0;
  const dz = location.z < min.z ? min.z - location.z : location.z > max.z ? location.z - max.z : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function processQueuedPlotBuildJobs(): void {
  if (fillQueue.length === 0) return;

  const jobsPerTick = 6;
  let processed = 0;
  while (fillQueueCursor < fillQueue.length && processed < jobsPerTick) {
    const job = fillQueue[fillQueueCursor++];
    if (!job) break;

    try {
      runFillCommand(job.min, job.max, job.block);
    } catch {
      fillQueue.push(job);
      break;
    }

    processed += 1;
    const remaining = (pendingJobCountsBySlot[job.slotId] ?? 1) - 1;
    if (remaining <= 0) {
      delete pendingJobCountsBySlot[job.slotId];
      if (!completedSlots.has(job.slotId)) {
        completedSlots.add(job.slotId);
        const dim = getDimension();
        for (const player of world.getAllPlayers()) {
          if (player.dimension.id === dim.id && distanceToBox(player.location, job.min, job.max) <= BUILD_PROXIMITY_RADIUS) {
            tell(player, `§a[Plots] Progress: ${completedSlots.size}/${buildSessionTotalSlots} plots complete.`);
            tell(player, `§a[Plots] Plot ${job.slotId} build complete.`);
          }
        }
      }
    } else {
      pendingJobCountsBySlot[job.slotId] = remaining;
    }
  }

  if (fillQueueCursor > 0 && (fillQueueCursor >= fillQueue.length || fillQueueCursor > 256)) {
    fillQueue.splice(0, fillQueueCursor);
    fillQueueCursor = 0;
  }
}

function buildSlotGeometry(slot: PlotSlot) {
  try {
    const auto = state.plots.config.autoBuild;
    if (auto.clearBase) {
      enqueueFill(slot.id, slot.min, slot.max, "air");
    }
    if (auto.floorBlock) {
      enqueueFill(
        slot.id,
        { x: slot.min.x, y: slot.min.y - 1, z: slot.min.z },
        { x: slot.max.x, y: slot.min.y - 1, z: slot.max.z },
        auto.floorBlock
      );
    }
    if (auto.addBorders) {
      const h = Math.max(1, auto.borderHeight);
      const y1 = slot.min.y;
      const y2 = Math.min(slot.max.y, y1 + h - 1);
      const x1 = slot.min.x - 1;
      const x2 = slot.max.x + 1;
      const z1 = slot.min.z - 1;
      const z2 = slot.max.z + 1;
      enqueueFill(slot.id, { x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z1 }, auto.borderBlock);
      enqueueFill(slot.id, { x: x1, y: y1, z: z2 }, { x: x2, y: y2, z: z2 }, auto.borderBlock);
      enqueueFill(slot.id, { x: x1, y: y1, z: z1 }, { x: x1, y: y2, z: z2 }, auto.borderBlock);
      enqueueFill(slot.id, { x: x2, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }, auto.borderBlock);
    }
    applyAutoBuildRoof(slot);
  } catch {
    // Ignore unloaded chunk/build errors
  }
}

function applyAutoBuildRoof(slot: PlotSlot): void {
  const auto = state.plots.config.autoBuild;
  if (!auto.roofBlock) return;
  const roofHeight = Math.max(1, Math.floor(auto.roofHeight));
  const top = slot.max.y;
  const bottom = Math.max(slot.min.y, top - roofHeight + 1);
  enqueueFill(
    slot.id,
    { x: slot.min.x, y: bottom, z: slot.min.z },
    { x: slot.max.x, y: top, z: slot.max.z },
    auto.roofBlock
  );
}

function clearAutoBuildRoof(slot: PlotSlot): void {
  const auto = state.plots.config.autoBuild;
  if (!auto.roofBlock) return;
  const roofHeight = Math.max(1, Math.floor(auto.roofHeight));
  const top = slot.max.y;
  const bottom = Math.max(slot.min.y, top - roofHeight + 1);
  enqueueFill(
    slot.id,
    { x: slot.min.x, y: bottom, z: slot.min.z },
    { x: slot.max.x, y: top, z: slot.max.z },
    "air"
  );
}

function enqueueLayoutClear(slots: PlotSlot[]): void {
  if (slots.length === 0) return;

  let minX = slots[0]!.min.x;
  let minY = slots[0]!.min.y;
  let minZ = slots[0]!.min.z;
  let maxX = slots[0]!.max.x;
  let maxY = slots[0]!.max.y;
  let maxZ = slots[0]!.max.z;

  for (const slot of slots) {
    if (slot.min.x < minX) minX = slot.min.x;
    if (slot.min.y < minY) minY = slot.min.y;
    if (slot.min.z < minZ) minZ = slot.min.z;
    if (slot.max.x > maxX) maxX = slot.max.x;
    if (slot.max.y > maxY) maxY = slot.max.y;
    if (slot.max.z > maxZ) maxZ = slot.max.z;
  }

  const auto = state.plots.config.autoBuild;
  const padding = Math.max(8, Math.floor(Math.max(state.plots.config.size.x, state.plots.config.size.z) / 2));
  const clearMin = {
    x: minX - padding,
    y: Math.max(0, minY - 8),
    z: minZ - padding,
  };
  const clearMax = {
    x: maxX + padding,
    y: maxY + Math.max(8, auto.borderHeight + auto.roofHeight + 8),
    z: maxZ + padding,
  };

  enqueueFill("layout_clear", clearMin, clearMax, "air");
}

export function buildPlotGeometry(slotId?: string): { ok: boolean; message: string } {
  const slot = slotId ? state.plots.slots[slotId] : undefined;
  if (slotId && !slot) return { ok: false, message: "Slot not found." };
  if (slot) {
    buildSessionTotalSlots = 1;
    completedSlots.clear();
    buildSlotGeometry(slot);
    return { ok: true, message: `Queued geometry build for ${slotId}. Get close to the plot to finish it.` };
  }

  const ids = getPlotSlots().map((slot) => slot.id);
  if (ids.length === 0) return { ok: false, message: "No plot slots configured." };
  buildSessionTotalSlots = ids.length;
  completedSlots.clear();
  enqueueLayoutClear(getPlotSlots());
  for (const id of ids) {
    const next = state.plots.slots[id];
    if (next) buildSlotGeometry(next);
  }
  return { ok: true, message: `Queued geometry build for ${ids.length} plots. Get close to each plot to finish it.` };
}

export function autoBuildPlots(): { ok: boolean; message: string } {
  const built = buildManualGridSlots();
  if (!built.ok) return built;
  enqueueLayoutClear(getPlotSlots());
  const geometry = buildPlotGeometry();
  if (!geometry.ok) return geometry;
  return { ok: true, message: `Built ${Object.keys(state.plots.slots).length} plots and queued geometry. Get close to each plot to finish it.` };
}

export function updatePlotAutoBuildSettings(partial: Partial<typeof state.plots.config.autoBuild>) {
  state.plots.config.autoBuild = { ...state.plots.config.autoBuild, ...partial };
  savePlots();
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
  savePlots();
  return true;
}

function intersects(a: PlotSlot, b: PlotSlot): boolean {
  return !(
    a.max.x < b.min.x || a.min.x > b.max.x ||
    a.max.y < b.min.y || a.min.y > b.max.y ||
    a.max.z < b.min.z || a.min.z > b.max.z
  );
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

export function forceReleasePlot(slotId: string): boolean {
  const slot = state.plots.slots[slotId];
  if (!slot) return false;
  if (slot.occupiedByPlayerId) {
    if (!saveAndClearSlot(slot, slot.occupiedByPlayerId)) return false;
    delete state.plots.playerToSlot[slot.occupiedByPlayerId];
  } else {
    clearSlot(slot);
  }
  slot.occupiedByPlayerId = undefined;
  savePlots();
  return true;
}

export function assignPlayerToSlot(player: Player, slotId: string): { ok: boolean; message: string } {
  const slot = state.plots.slots[slotId];
  if (!slot) return { ok: false, message: "Slot not found." };
  if (slot.occupiedByPlayerId) return { ok: false, message: "Slot already occupied." };
  const playerId = getPlayerId(player);
  const ownerPlayerId = getPlotOwnerIdForPlayerId(playerId);
  const previous = state.plots.playerToSlot[ownerPlayerId];
  if (previous && previous !== slotId) {
    const previousSlot = state.plots.slots[previous];
    if (previousSlot) {
      if (!saveAndClearSlot(previousSlot, ownerPlayerId)) {
        return { ok: false, message: "Failed to save the current plot before reassignment." };
      }
      previousSlot.occupiedByPlayerId = undefined;
    }
  }
  state.plots.playerToSlot[ownerPlayerId] = slotId;
  slot.occupiedByPlayerId = ownerPlayerId;
  clearSlot(slot);
  loadSlotSnapshot(slot, ownerPlayerId);
  saveSlotSnapshot(slot, ownerPlayerId, captureSlotGenerators(slot, ownerPlayerId));
  savePlots();
  return { ok: true, message: `Assigned ${player.name} to ${slotId}.` };
}

export function teleportPlayerToSlot(player: Player, slotId: string): { ok: boolean; message: string } {
  const slot = state.plots.slots[slotId];
  if (!slot) return { ok: false, message: "Slot not found." };
  const dim = getDimension();
  if (player.dimension.id !== dim.id) return { ok: false, message: `Player is in ${player.dimension.id}, slot is in ${dim.id}.` };
  const cx = (slot.min.x + slot.max.x) / 2 + 0.5;
  const cz = (slot.min.z + slot.max.z) / 2 + 0.5;
  player.teleport({ x: cx, y: slot.min.y + 1, z: cz }, { dimension: dim });
  return { ok: true, message: `Teleported to ${slotId}.` };
}

function structureNameForPlayer(playerId: string): string {
  return `${STORAGE_KEYS.plots.replace(":", "_")}_${playerId}`;
}

function isGeneratorInSlot(generator: PlacedGenerator, slot: PlotSlot): boolean {
  return generator.dimensionId === state.plots.config.dimensionId &&
    generator.x >= slot.min.x && generator.x <= slot.max.x &&
    generator.y >= slot.min.y && generator.y <= slot.max.y &&
    generator.z >= slot.min.z && generator.z <= slot.max.z;
}

type SnapshotGeneratorEntry = NonNullable<PlotSnapshot["generators"]>[number];

function isLegacySnapshotGenerator(entry: SnapshotGeneratorEntry): entry is PlacedGenerator {
  return (entry as PlacedGenerator).id !== undefined;
}

function toGeneratorLocationKey(dimensionId: string, x: number, y: number, z: number): string {
  return `${dimensionId}:${Math.floor(x)}:${Math.floor(y)}:${Math.floor(z)}`;
}

function captureSlotGenerators(slot: PlotSlot, snapshotOwnerPlayerId: string): PlotSnapshot["generators"] {
  return Object.values(state.generators.placed)
    .filter((generator) => isGeneratorInSlot(generator, slot))
    .map((generator) => ({
      definitionId: generator.definitionId,
      ownerPlayerId: snapshotOwnerPlayerId,
      dx: generator.x - slot.min.x,
      dy: generator.y - slot.min.y,
      dz: generator.z - slot.min.z,
      tier: generator.tier,
      nextSpawnAt: generator.nextSpawnAt,
      autoBreakerPurchased: Boolean(generator.autoBreakerPurchased),
      autoBreakerEnabled: Boolean(generator.autoBreakerEnabled),
    }));
}

function removeSlotGenerators(slot: PlotSlot): boolean {
  const ids: string[] = [];
  for (const [id, generator] of Object.entries(state.generators.placed)) {
    if (isGeneratorInSlot(generator, slot)) ids.push(id);
  }
  if (ids.length === 0) return false;
  for (const id of ids) {
    delete state.generators.placed[id];
  }
  return true;
}

function restoreSlotGenerators(snapshot: PlotSnapshot | undefined, slot: PlotSlot, ownerPlayerId: string): boolean {
  if (!snapshot?.generators || snapshot.generators.length === 0) return false;
  const sourceMin = snapshot.sourceMin ?? slot.min;
  let restoredAny = false;
  for (const entry of snapshot.generators) {
    const normalized = isLegacySnapshotGenerator(entry)
      ? {
          definitionId: entry.definitionId,
          dx: entry.x - sourceMin.x,
          dy: entry.y - sourceMin.y,
          dz: entry.z - sourceMin.z,
          tier: entry.tier,
          nextSpawnAt: entry.nextSpawnAt,
          autoBreakerPurchased: Boolean((entry as { autoBreakerPurchased?: boolean }).autoBreakerPurchased),
          autoBreakerEnabled: Boolean((entry as { autoBreakerEnabled?: boolean }).autoBreakerEnabled),
        }
      : entry;
    const x = slot.min.x + normalized.dx;
    const y = slot.min.y + normalized.dy;
    const z = slot.min.z + normalized.dz;
    if (x < slot.min.x || x > slot.max.x || y < slot.min.y || y > slot.max.y || z < slot.min.z || z > slot.max.z) continue;
    const dimensionId = state.plots.config.dimensionId;
    const id = toGeneratorLocationKey(dimensionId, x, y, z);
    state.generators.placed[id] = {
      id,
      definitionId: normalized.definitionId,
      ownerPlayerId,
      dimensionId,
      x,
      y,
      z,
      tier: Math.max(1, Math.floor(normalized.tier) || 1),
      nextSpawnAt: Math.max(Date.now(), Math.floor(normalized.nextSpawnAt) || Date.now()),
      autoBreakerPurchased: Boolean((normalized as { autoBreakerPurchased?: boolean }).autoBreakerPurchased),
      autoBreakerEnabled: Boolean((normalized as { autoBreakerEnabled?: boolean }).autoBreakerEnabled),
    };
    restoredAny = true;
  }
  return restoredAny;
}

function getDimension() {
  return world.getDimension(state.plots.config.dimensionId);
}

function saveSlotSnapshot(slot: PlotSlot, playerId: string, generators?: PlotSnapshot["generators"]): boolean {
  const dim = getDimension();
  const name = structureNameForPlayer(playerId);
  const snapshotGenerators = generators ?? captureSlotGenerators(slot, playerId);
  try {
    dim.runCommand(
      `structure save ${name} ${slot.min.x} ${slot.min.y} ${slot.min.z} ${slot.max.x} ${slot.max.y} ${slot.max.z} true disk true`
    );
    state.plots.snapshots[playerId] = {
      slotId: slot.id,
      structureId: name,
      savedAt: Date.now(),
      sourceMin: { ...slot.min },
      generators: snapshotGenerators,
    };
    return true;
  } catch {
    snapshotQueue.push({ playerId, slotId: slot.id, mode: "save", attempts: 0, generators: snapshotGenerators });
    return false;
  }
}

function loadSlotSnapshot(slot: PlotSlot, playerId: string): boolean {
  const snap = state.plots.snapshots[playerId];
  if (!snap) return false;
  snap.slotId = slot.id;
  const dim = getDimension();
  try {
    dim.runCommand(`structure load ${snap.structureId} ${slot.min.x} ${slot.min.y} ${slot.min.z} 0_degrees none true true false 100`);
    applyAutoBuildRoof(slot);
    if (restoreSlotGenerators(snap, slot, playerId)) saveGenerators();
    return true;
  } catch {
    snapshotQueue.push({ playerId, slotId: slot.id, mode: "load", attempts: 0 });
    return false;
  }
}

export function processQueuedPlotSnapshots(): void {
  if (snapshotQueue.length === 0 || !canUsePlotCommandsNow()) return;

  const retryLimit = 20;
  const current = snapshotQueue.splice(0, snapshotQueue.length);
  for (const job of current) {
    const slot = state.plots.slots[job.slotId];
    if (!slot) continue;

    const ok = job.mode === "save"
      ? saveSlotSnapshot(slot, job.playerId, job.generators)
      : loadSlotSnapshot(slot, job.playerId);
    if (!ok && job.attempts + 1 < retryLimit) {
      snapshotQueue.push({ ...job, attempts: job.attempts + 1 });
    }
  }
}

function clearSlot(slot: PlotSlot) {
  const dim = getDimension();
  try {
    const selector = `@e[type=!player,x=${slot.min.x},y=${slot.min.y},z=${slot.min.z},dx=${slot.max.x - slot.min.x},dy=${slot.max.y - slot.min.y},dz=${slot.max.z - slot.min.z}]`;
    dim.runCommand(`kill ${selector}`);
    dim.runCommand(`kill @e[type=item,x=${slot.min.x},y=${slot.min.y},z=${slot.min.z},dx=${slot.max.x - slot.min.x},dy=${slot.max.y - slot.min.y},dz=${slot.max.z - slot.min.z}]`);
    dim.runCommand(`fill ${slot.min.x} ${slot.min.y} ${slot.min.z} ${slot.max.x} ${slot.max.y} ${slot.max.z} air`);
    dim.runCommand(`kill @e[type=item,x=${slot.min.x},y=${slot.min.y},z=${slot.min.z},dx=${slot.max.x - slot.min.x},dy=${slot.max.y - slot.min.y},dz=${slot.max.z - slot.min.z}]`);
  } catch {
    // Ignore fill failures for unloaded chunks
  }
  if (removeSlotGenerators(slot)) saveGenerators();
}

function saveAndClearSlot(slot: PlotSlot, ownerPlayerId: string): boolean {
  const capturedGenerators = captureSlotGenerators(slot, ownerPlayerId);
  if (!saveSlotSnapshot(slot, ownerPlayerId, capturedGenerators)) return false;
  clearSlot(slot);
  return true;
}

export function clearAllPlotSlots(): { ok: boolean; message: string } {
  const slots = getPlotSlots();
  if (slots.length === 0) return { ok: false, message: "No plot slots configured." };
  let cleared = 0;
  for (const slot of slots) {
    if (slot.occupiedByPlayerId) continue;
    clearSlot(slot);
    cleared += 1;
  }
  savePlots();
  return { ok: true, message: `Cleaned ${cleared} free plot slots. Assigned plots were left alone.` };
}

export function clearSlotById(slotId: string): { ok: boolean; message: string } {
  const slot = state.plots.slots[slotId];
  if (!slot) return { ok: false, message: "Slot not found." };
  const previousOwnerId = slot.occupiedByPlayerId;
  if (slot.occupiedByPlayerId) {
    if (!saveAndClearSlot(slot, slot.occupiedByPlayerId)) {
      return { ok: false, message: "Failed to save slot snapshot before clearing." };
    }
  } else {
    clearSlot(slot);
  }
  slot.occupiedByPlayerId = undefined;
  if (previousOwnerId) delete state.plots.playerToSlot[previousOwnerId];
  savePlots();
  return { ok: true, message: `Cleared slot ${slotId}.` };
}

function findFreeSlotId(): string | undefined {
  for (const slot of getPlotSlots()) {
    if (!slot.occupiedByPlayerId) return slot.id;
  }
  return undefined;
}

export function assignPlayerToFreeSlot(player: Player): { ok: boolean; message: string } {
  const free = findFreeSlotId();
  if (!free) return { ok: false, message: "No available plot slots." };
  return assignPlayerToSlot(player, free);
}

function reconcileOnlinePlotAssignmentsInternal(reason: string): { ok: boolean; assigned: number; fixed: number; failed: number; message: string } {
  const reconciled = reconcileAllPlotState(reason);
  return {
    ok: reconciled.ok,
    assigned: reconciled.assigned,
    fixed: reconciled.fixed,
    failed: reconciled.failed,
    message: reconciled.message,
  };
}

export function syncOnlinePlotAssignments(): { ok: boolean; assigned: number; fixed: number; failed: number; message: string } {
  return reconcileOnlinePlotAssignmentsInternal("sync");
}

export function ensureOnlinePlotsAssigned(): { ok: boolean; assigned: number; failed: number; message: string } {
  const reconciled = reconcileOnlinePlotAssignmentsInternal("ensure_online");
  return {
    ok: reconciled.ok,
    assigned: reconciled.assigned,
    failed: reconciled.failed,
    message: `Ensured plots for ${reconciled.assigned} online player(s).`,
  };
}

export function ensurePlayerPlotAssigned(player: Player): { ok: boolean; assigned: boolean; message: string } {
  if (!state.plots.config.enabled) {
    return { ok: true, assigned: false, message: "Plots are disabled." };
  }

  const playerId = getPlayerId(player);
  const ownerId = getPlotOwnerIdForPlayerId(playerId);
  const team = getPlayerTeam(player);
  if (team?.teamPlotEnabled && ownerId !== playerId) {
    return { ok: true, assigned: false, message: "Team member plot suspended while team plot is enabled." };
  }

  const slotId = resolveAuthoritativeOwnedSlotId(ownerId) ?? state.plots.playerToSlot[ownerId];
  const slot = slotId ? state.plots.slots[slotId] : undefined;
  if (slot && slot.occupiedByPlayerId === ownerId) {
    if (state.plots.playerToSlot[ownerId] !== slot.id) {
      state.plots.playerToSlot[ownerId] = slot.id;
      savePlots();
    }
    return { ok: true, assigned: false, message: `Plot ${slot.id} already assigned.` };
  }

  const deployed = deployPlayerPlot(player);
  return { ok: deployed.ok, assigned: deployed.ok, message: deployed.message };
}

export function repairPlotSystem(): { ok: boolean; fixed: number; assigned: number; message: string } {
  const reconciled = reconcileAllPlotState("manual_repair");
  const message = `Repaired plots: ${reconciled.fixed} fixes applied, ${reconciled.assigned} online assigned.${reconciled.reordered ? " Slot order normalized." : ""}`;
  return { ok: reconciled.ok, fixed: reconciled.fixed, assigned: reconciled.assigned, message };
}

export type PlotReconcileResult = {
  ok: boolean;
  fixed: number;
  assigned: number;
  failed: number;
  reordered: boolean;
  message: string;
};

export function reconcileAllPlotState(reason: string = "general"): PlotReconcileResult {
  if (!state.plots.config.enabled) {
    return {
      ok: true,
      fixed: 0,
      assigned: 0,
      failed: 0,
      reordered: false,
      message: `Plots disabled; skipped reconcile (${reason}).`,
    };
  }

  const reordered = reorderPlotSlots();
  const ownership = reconcilePlotOwnershipData();
  const teamPlotsReconciled = reconcileTeamPlotSlots();

  const ownerRepresentatives = new Map<string, Player>();
  for (const player of world.getAllPlayers()) {
    const playerId = getPlayerId(player);
    const ownerId = getPlotOwnerIdForPlayerId(playerId);
    if (!ownerRepresentatives.has(ownerId)) ownerRepresentatives.set(ownerId, player);
  }

  let assigned = 0;
  let failed = 0;
  let fixed =
    (ownership.mappingsFixed ?? 0) +
    (ownership.snapshotsFixed ?? 0) +
    (ownership.generatorsFixed ?? 0) +
    (reordered ? 1 : 0) +
    (teamPlotsReconciled ? 1 : 0);

  for (const [ownerId, representative] of ownerRepresentatives.entries()) {
    const slotId = resolveAuthoritativeOwnedSlotId(ownerId) ?? state.plots.playerToSlot[ownerId];
    const slot = slotId ? state.plots.slots[slotId] : undefined;
    if (slot && slot.occupiedByPlayerId === ownerId) {
      if (state.plots.playerToSlot[ownerId] !== slot.id) {
        state.plots.playerToSlot[ownerId] = slot.id;
        fixed += 1;
      }
      if (repairOwnedPlotSlots(ownerId, slot.id)) fixed += 1;
      continue;
    }

    const deployed = deployPlayerPlot(representative);
    if (deployed.ok) {
      assigned += 1;
      if (slotId) fixed += 1;
    } else {
      failed += 1;
    }
  }

  if (fixed > 0 || assigned > 0 || failed > 0) savePlots();

  cachedPlotSlots = undefined;
  cachedPlotSlotsSource = undefined;
  return {
    ok: ownership.ok && failed === 0,
    fixed,
    assigned,
    failed,
    reordered,
    message: `Reconciled plots (${reason}) fixed=${fixed} assigned=${assigned} failed=${failed}.`,
  };
}

export function clearPlayerPlot(playerId: string): boolean {
  const slotId = state.plots.playerToSlot[playerId];
  if (!slotId) return true;
  const result = releasePlayerPlotById(playerId);
  return result.ok;
}

export function deployPlayerPlot(player: Player): { ok: boolean; message: string } {
  if (!state.plots.config.enabled) return { ok: true, message: "Plots disabled." };
  const ownerId = getPlotOwnerIdForPlayer(player) ?? getPlayerId(player);

  const assigned = resolveAuthoritativeOwnedSlotId(ownerId) ?? state.plots.playerToSlot[ownerId];
  let slotId: string;
  if (!assigned || !state.plots.slots[assigned]) {
    const free = findFreeSlotId();
    if (!free) return { ok: false, message: "No available plot slots." };
    slotId = free;
    state.plots.playerToSlot[ownerId] = free;
  } else {
    slotId = assigned;
  }

  const slot = state.plots.slots[slotId];
  if (!slot) return { ok: false, message: "Assigned slot not found." };
  const dim = getDimension();
  if (slot.occupiedByPlayerId && slot.occupiedByPlayerId !== ownerId) {
    return { ok: false, message: "Assigned plot is occupied." };
  }

  slot.occupiedByPlayerId = ownerId;
  clearSlot(slot);
  loadSlotSnapshot(slot, ownerId);
  applyAutoBuildRoof(slot);
  saveSlotSnapshot(slot, ownerId, captureSlotGenerators(slot, ownerId));
  savePlots();
  return { ok: true, message: `Plot ${slotId} deployed.` };
}

export function getPlotOwnerIdForPlayer(player: Player): string | undefined {
  return getPlotOwnerIdForPlayerId(getPlayerId(player));
}

export function saveAssignedPlayerPlot(player: Player): boolean {
  const ownerId = getPlotOwnerIdForPlayer(player);
  if (!ownerId) return false;
  const slotId = state.plots.playerToSlot[ownerId];
  if (!slotId) return false;
  const slot = state.plots.slots[slotId];
  if (!slot) return false;
  const saved = saveSlotSnapshot(slot, ownerId, captureSlotGenerators(slot, ownerId));
  if (saved) savePlots();
  return saved;
}

export function savePlotAtLocation(location: Vector3): boolean {
  const slot = getPlotForLocation(location);
  if (!slot || !slot.occupiedByPlayerId) return false;
  const saved = saveSlotSnapshot(slot, slot.occupiedByPlayerId, captureSlotGenerators(slot, slot.occupiedByPlayerId));
  if (saved) savePlots();
  return saved;
}

export function releasePlayerPlotByName(playerName: string): { ok: boolean; message: string } {
  const playerId = state.stats.playerIds[playerName];
  if (!playerId) return { ok: false, message: "Player ID not found." };
  return releasePlayerPlotById(playerId);
}

export function releasePlayerPlotById(playerId: string): { ok: boolean; message: string } {
  const slotId = state.plots.playerToSlot[playerId];
  if (!slotId) return { ok: false, message: "No assigned plot." };
  const slot = state.plots.slots[slotId];
  if (!slot) return { ok: false, message: "Assigned slot missing." };

  if (!saveAndClearSlot(slot, playerId)) {
    return { ok: false, message: "Failed to save plot snapshot before release." };
  }
  slot.occupiedByPlayerId = undefined;
  delete state.plots.playerToSlot[playerId];
  savePlots();
  return { ok: true, message: `Plot ${slotId} saved and cleared.` };
}

export function showPlotError(player: Player, message: string) {
  tell(player, `§c[Plots] ${message}`);
}

export function getPlotForLocation(location: Vector3): PlotSlot | undefined {
  for (const slot of getPlotSlots()) {
    if (
      location.x >= slot.min.x && location.x <= slot.max.x &&
      location.y >= slot.min.y && location.y <= slot.max.y &&
      location.z >= slot.min.z && location.z <= slot.max.z
    ) {
      return slot;
    }
  }
  return undefined;
}

export function getPlotTitle(slot: PlotSlot): string {
  const auto = state.plots.config.autoBuild;
  if (auto.titleMode === "plot") return `Plot ${slot.id}`;
  if (!slot.occupiedByPlayerId) return `Plot ${slot.id}`;
  const team = Object.values(state.teams.teams).find((entry) => entry.ownerPlayerId === slot.occupiedByPlayerId);
  if (team && team.teamPlotEnabled) return `${team.name} Plot`;
  const ownerName = Object.entries(state.stats.playerIds).find(([, pid]) => pid === slot.occupiedByPlayerId)?.[0];
  return ownerName ? `${ownerName}'s Plot` : `Plot ${slot.id}`;
}
