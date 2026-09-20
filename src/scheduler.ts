import { system } from "@minecraft/server";

type TickInterval = number | (() => number);

type BackgroundTask = {
  id: string;
  run: () => void;
  intervalTicks: TickInterval;
  initialOffsetTicks?: number;
  nextDueTick: number;
};

const MAX_BACKGROUND_TASKS_PER_TICK = 6;

const backgroundTasks = new Map<string, BackgroundTask>();
let dispatcherStarted = false;

function normalizeTicks(value: number): number {
  return Math.max(1, Math.floor(value));
}

function resolveInterval(task: BackgroundTask): number {
  return normalizeTicks(typeof task.intervalTicks === "function" ? task.intervalTicks() : task.intervalTicks);
}

function safeRun(id: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    console.warn(`[TauUtils] Background task ${id} failed: ${error}`);
  }
}

function runBackgroundSchedulerTick(): void {
  let started = 0;
  for (const task of backgroundTasks.values()) {
    if (started >= MAX_BACKGROUND_TASKS_PER_TICK) break;
    if (system.currentTick < task.nextDueTick) continue;

    safeRun(task.id, task.run);
    task.nextDueTick = system.currentTick + resolveInterval(task);
    started++;
  }
}

function ensureBackgroundSchedulerStarted(): void {
  if (dispatcherStarted) return;
  dispatcherStarted = true;
  system.runInterval(runBackgroundSchedulerTick, 1);
}

export function registerBackgroundTask(id: string, intervalTicks: TickInterval, run: () => void, initialOffsetTicks = 0): void {
  const offset = Math.max(0, Math.floor(initialOffsetTicks));
  backgroundTasks.set(id, {
    id,
    run,
    intervalTicks,
    initialOffsetTicks: offset,
    nextDueTick: system.currentTick + offset,
  });
  ensureBackgroundSchedulerStarted();
}

/**
 * Stagger convention: every background task takes a small unique
 * initialOffsetTicks so 20-tick systems never wake on the same tick.
 * In-use offsets: combat-tags 1, lifecycle-shutdown-flush 2, sidebar-render 3,
 * custom-areas 4, claims 6, stats-sample 7, tpa-expiry 9, plot-auto-save 11,
 * plot-enter-title 13, plot-build-queue 15, moderation-snapshot 17,
 * generators 18. Pick the next free small integer for new tasks.
 */
