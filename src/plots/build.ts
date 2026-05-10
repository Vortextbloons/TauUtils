import { Player, Vector3, world } from "@minecraft/server";
import { STORAGE_KEYS, type PlacedGenerator, type PlotSnapshot, type PlotSlot, type TeamDefinition } from "../types";
import { getPlayerId, saveGenerators, savePlots, saveTeams, state, tell } from "../storage";
import { getPlotSlots, getDimension, invalidatePlotSlotCache, parseSlotIndex, slotName, buildManualGridSlots, MAX_FILL_VOLUME, MAX_FILL_SPAN, BUILD_PROXIMITY_RADIUS } from "./grid";

export function reorderPlotSlots(): boolean {
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
  invalidatePlotSlotCache();
  savePlots();
  saveTeams();
  return true;
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
  nextAttemptAt?: number;
  generators?: PlotSnapshot["generators"];
};

const fillQueue: FillJob[] = [];
let fillQueueCursor = 0;
const pendingJobCountsBySlot: Record<string, number> = {};
const completedSlots: Set<string> = new Set();
let buildSessionTotalSlots = 0;
export const snapshotQueue: SnapshotJob[] = [];
const SNAPSHOT_JOBS_PER_TICK = 1;
const PLOT_SPATIAL_CELL_SIZE = 64;

type PlotSpatialIndex = {
  signature: string;
  buckets: Map<string, PlotSlot[]>;
};

let plotSpatialIndex: PlotSpatialIndex | undefined;

function plotSpatialSignature(): string {
  return `${state.plots.config.dimensionId}|${getPlotSlots().map((slot) => `${slot.id}:${slot.min.x},${slot.min.y},${slot.min.z}:${slot.max.x},${slot.max.y},${slot.max.z}`).join("|")}`;
}

function bucketCoord(value: number): number {
  return Math.floor(value / PLOT_SPATIAL_CELL_SIZE);
}

function bucketKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function buildPlotSpatialIndex(): PlotSpatialIndex {
  const buckets = new Map<string, PlotSlot[]>();
  for (const slot of getPlotSlots()) {
    const minX = bucketCoord(slot.min.x);
    const maxX = bucketCoord(slot.max.x);
    const minY = bucketCoord(slot.min.y);
    const maxY = bucketCoord(slot.max.y);
    const minZ = bucketCoord(slot.min.z);
    const maxZ = bucketCoord(slot.max.z);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = bucketKey(x, y, z);
          const slots = buckets.get(key) ?? [];
          slots.push(slot);
          buckets.set(key, slots);
        }
      }
    }
  }
  return { signature: plotSpatialSignature(), buckets };
}

function getPlotSpatialIndex(): PlotSpatialIndex {
  const signature = plotSpatialSignature();
  if (!plotSpatialIndex || plotSpatialIndex.signature !== signature) {
    plotSpatialIndex = buildPlotSpatialIndex();
  }
  return plotSpatialIndex;
}

export function invalidatePlotRuntimeCaches(): void {
  plotSpatialIndex = undefined;
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

export function applyAutoBuildRoof(slot: PlotSlot): void {
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
  const geometry = buildPlotGeometry();
  if (!geometry.ok) return geometry;
  return { ok: true, message: `Built ${Object.keys(state.plots.slots).length} plots and queued geometry. Get close to each plot to finish it.` };
}

export function updatePlotAutoBuildSettings(partial: Partial<typeof state.plots.config.autoBuild>) {
  state.plots.config.autoBuild = { ...state.plots.config.autoBuild, ...partial };
  savePlots();
}

type SnapshotGeneratorEntry = NonNullable<PlotSnapshot["generators"]>[number];

function isLegacySnapshotGenerator(entry: SnapshotGeneratorEntry): entry is PlacedGenerator {
  return (entry as PlacedGenerator).id !== undefined;
}

function toGeneratorLocationKey(dimensionId: string, x: number, y: number, z: number): string {
  return `${dimensionId}:${Math.floor(x)}:${Math.floor(y)}:${Math.floor(z)}`;
}

export function captureSlotGenerators(slot: PlotSlot, snapshotOwnerPlayerId: string): PlotSnapshot["generators"] {
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

function structureNameForPlayer(playerId: string): string {
  return `${STORAGE_KEYS.plots.replace(":", "_")}_${playerId}`;
}

export function isGeneratorInSlot(generator: PlacedGenerator, slot: PlotSlot): boolean {
  return generator.dimensionId === state.plots.config.dimensionId &&
    generator.x >= slot.min.x && generator.x <= slot.max.x &&
    generator.y >= slot.min.y && generator.y <= slot.max.y &&
    generator.z >= slot.min.z && generator.z <= slot.max.z;
}

export function saveSlotSnapshot(slot: PlotSlot, playerId: string, generators?: PlotSnapshot["generators"], queueOnFailure = true): boolean {
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
    if (queueOnFailure) snapshotQueue.push({ playerId, slotId: slot.id, mode: "save", attempts: 0, generators: snapshotGenerators });
    return false;
  }
}

export function loadSlotSnapshot(slot: PlotSlot, playerId: string, queueOnFailure = true): boolean {
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
    if (queueOnFailure) snapshotQueue.push({ playerId, slotId: slot.id, mode: "load", attempts: 0 });
    return false;
  }
}

export function processQueuedPlotSnapshots(): void {
  if (snapshotQueue.length === 0 || !canUsePlotCommandsNow()) return;

  const retryLimit = 20;
  let processed = 0;
  let scanned = 0;
  const maxScans = snapshotQueue.length;
  while (snapshotQueue.length > 0 && processed < SNAPSHOT_JOBS_PER_TICK && scanned < maxScans) {
    const job = snapshotQueue.shift();
    scanned++;
    if (!job) break;
    if ((job.nextAttemptAt ?? 0) > Date.now()) {
      snapshotQueue.push(job);
      continue;
    }

    const slot = state.plots.slots[job.slotId];
    if (!slot) continue;

    const ok = job.mode === "save"
      ? saveSlotSnapshot(slot, job.playerId, job.generators, false)
      : loadSlotSnapshot(slot, job.playerId, false);
    processed++;
    if (!ok && job.attempts + 1 < retryLimit) {
      const attempts = job.attempts + 1;
      snapshotQueue.push({ ...job, attempts, nextAttemptAt: Date.now() + Math.min(5000, attempts * 250) });
    }
  }
}

export function clearSlot(slot: PlotSlot) {
  const dim = getDimension();
  try {
    const selector = `@e[type=!player,x=${slot.min.x},y=${slot.min.y},z=${slot.min.z},dx=${slot.max.x - slot.min.x},dy=${slot.max.y - slot.min.y},dz=${slot.max.z - slot.min.z}]`;
    dim.runCommand(`kill ${selector}`);
    dim.runCommand(`kill @e[type=item,x=${slot.min.x},y=${slot.min.y},z=${slot.min.z},dx=${slot.max.x - slot.min.x},dy=${slot.max.y - slot.min.y},dz=${slot.max.z - slot.min.z}]`);
    enqueueFill(slot.id, slot.min, slot.max, "air");
  } catch {
    // Ignore fill failures for unloaded chunks
  }
  if (removeSlotGenerators(slot)) saveGenerators();
}

export function saveAndClearSlot(slot: PlotSlot, ownerPlayerId: string): boolean {
  const capturedGenerators = captureSlotGenerators(slot, ownerPlayerId);
  if (!saveSlotSnapshot(slot, ownerPlayerId, capturedGenerators)) return false;
  clearSlot(slot);
  return true;
}

export function getPlotForLocation(location: Vector3): PlotSlot | undefined {
  const index = getPlotSpatialIndex();
  const candidates = index.buckets.get(bucketKey(bucketCoord(location.x), bucketCoord(location.y), bucketCoord(location.z))) ?? [];
  for (const slot of candidates) {
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
