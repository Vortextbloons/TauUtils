import { system } from "@minecraft/server";

type TickInterval = number | (() => number);

type BackgroundTask = {
  id: string;
  run: () => void;
  intervalTicks: TickInterval;
  initialOffsetTicks?: number;
  nextDueTick: number;
};

type EveryTickTask = {
  id: string;
  run: () => void;
};

const MAX_BACKGROUND_TASKS_PER_TICK = 6;

const backgroundTasks = new Map<string, BackgroundTask>();
const everyTickTasks = new Map<string, EveryTickTask>();
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
  for (const task of everyTickTasks.values()) {
    safeRun(task.id, task.run);
  }

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

export function registerEveryTickTask(id: string, run: () => void): void {
  everyTickTasks.set(id, { id, run });
  ensureBackgroundSchedulerStarted();
}
