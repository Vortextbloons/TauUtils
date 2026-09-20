import { system, world } from "@minecraft/server";
import {
  isFeatureEnabled,
  readTpaInbox,
  readTpaOutbox,
  saveTpaInboxFor,
  saveTpaOutboxFor,
  state,
  tpaInboxPlayerIds,
  tpaOutboxPlayerIds,
} from "../storage";
import { registerBackgroundTask } from "../scheduler";
import { onTpaIncomingRequest } from "./core";

// Single guard for the expiry sweep. Replaces the old
// expirySweepScheduled (runTimeout debounce) + expirySweepJobId pair:
// the scheduler tick is the only trigger, so one in-flight flag suffices.
let expirySweepJobId: number | undefined;

function purgeExpiredInbox(playerId: string, now: number): boolean {
  const inbox = readTpaInbox(playerId);
  const filtered = inbox.filter((req) => req.expiresAt > now);
  if (filtered.length === inbox.length) return false;
  saveTpaInboxFor(playerId, filtered);
  return true;
}

function purgeExpiredOutbox(playerId: string, now: number): boolean {
  const outbox = readTpaOutbox(playerId);
  const filtered = outbox.filter((req) => req.expiresAt > now);
  if (filtered.length === outbox.length) return false;
  saveTpaOutboxFor(playerId, filtered);
  return true;
}

function* processTpaExpiryJob(): Generator<void, void, void> {
  const now = Date.now();
  const propertyIds = world.getDynamicPropertyIds();
  const inboxIds = tpaInboxPlayerIds(propertyIds);
  for (const playerId of inboxIds) {
    purgeExpiredInbox(playerId, now);
    yield;
  }
  const outboxIds = tpaOutboxPlayerIds(propertyIds);
  for (const playerId of outboxIds) {
    purgeExpiredOutbox(playerId, now);
    yield;
  }
  expirySweepJobId = undefined;
}

export function processTpaExpiry(): void {
  if (!isFeatureEnabled("tpa")) return;
  if (!state.tpa.config.enabled) return;
  if (expirySweepJobId !== undefined) return;
  expirySweepJobId = system.runJob(processTpaExpiryJob());
}

export function registerTpaIncomingHandler(handler: (targetId: string, request: import("../types").TpaRequest) => void): () => void {
  return onTpaIncomingRequest(handler);
}

export function startTpaExpiryLoop(): void {
  if (!isFeatureEnabled("tpa")) return;
  if (!state.tpa.config.enabled) return;
  // Offset 9 staggers this 1200-tick sweep away from the 20-tick crowd
  // (combat-tags 1, sidebar-render 3, custom-areas 4, claims 6, stats 7,
  // plot-auto-save 11, plot-title 13, plot-queue 15, moderation 17, gens 18).
  registerBackgroundTask("tpa-expiry", 1200, processTpaExpiry, 9);
}
