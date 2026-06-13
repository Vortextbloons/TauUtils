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
import { onTpaIncomingRequest } from "./core";

let expirySweepScheduled = false;
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

function scheduleTpaExpirySweep(): void {
  if (!isFeatureEnabled("tpa")) return;
  if (!state.tpa.config.enabled) return;
  if (expirySweepJobId !== undefined) return;
  expirySweepJobId = system.runJob(processTpaExpiryJob());
}

export function processTpaExpiry(): void {
  if (!isFeatureEnabled("tpa")) return;
  if (!state.tpa.config.enabled) return;
  if (expirySweepScheduled) return;
  expirySweepScheduled = true;
  system.runTimeout(() => {
    expirySweepScheduled = false;
    scheduleTpaExpirySweep();
  }, 200);
}

export function registerTpaIncomingHandler(handler: (targetId: string, request: import("../types").TpaRequest) => void): () => void {
  return onTpaIncomingRequest(handler);
}

export function startTpaExpiryLoop(): void {
  if (!isFeatureEnabled("tpa")) return;
  if (!state.tpa.config.enabled) return;
  system.runInterval(() => {
    processTpaExpiry();
  }, 1200);
}
