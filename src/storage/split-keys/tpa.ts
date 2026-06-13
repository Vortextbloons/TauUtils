import { world } from "@minecraft/server";
import { STORAGE_KEYS, type TpaRequest } from "../../types";
import { parseJSON, safeSetDynamicJson, setDynamicJsonIfChanged } from "../dynamic-json";

export const TPA_INBOX_PREFIX = `${STORAGE_KEYS.tpa}:inbox:`;
export const TPA_COOLDOWN_PREFIX = `${STORAGE_KEYS.tpa}:cooldown:`;
export const TPA_OUTBOX_PREFIX = `${STORAGE_KEYS.tpa}:outbox:`;

const persistedInboxKeys = new Set<string>();
const persistedCooldownKeys = new Set<string>();
const persistedOutboxKeys = new Set<string>();

const persisted = new Map<string, string>();

function inboxKey(playerId: string): string {
  return `${TPA_INBOX_PREFIX}${playerId}`;
}

function cooldownKey(playerId: string): string {
  return `${TPA_COOLDOWN_PREFIX}${playerId}`;
}

function outboxKey(playerId: string): string {
  return `${TPA_OUTBOX_PREFIX}${playerId}`;
}

export function readTpaInbox(playerId: string): TpaRequest[] {
  const raw = world.getDynamicProperty(inboxKey(playerId)) as string | undefined;
  if (!raw) return [];
  const parsed = parseJSON<TpaRequest[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function writeTpaInbox(playerId: string, requests: TpaRequest[]): boolean {
  const key = inboxKey(playerId);
  persistedInboxKeys.add(key);
  return setDynamicJsonIfChanged(key, requests, persisted);
}

export function readTpaOutbox(playerId: string): TpaRequest[] {
  const raw = world.getDynamicProperty(outboxKey(playerId)) as string | undefined;
  if (!raw) return [];
  const parsed = parseJSON<TpaRequest[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function writeTpaOutbox(playerId: string, requests: TpaRequest[]): boolean {
  const key = outboxKey(playerId);
  persistedOutboxKeys.add(key);
  return setDynamicJsonIfChanged(key, requests, persisted);
}

export function readTpaCooldown(playerId: string): number {
  const raw = world.getDynamicProperty(cooldownKey(playerId)) as string | undefined;
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function writeTpaCooldown(playerId: string, untilMs: number): boolean {
  const key = cooldownKey(playerId);
  persistedCooldownKeys.add(key);
  if (!setDynamicJsonIfChanged(key, untilMs, persisted)) return false;
  return true;
}

export function loadTpaFromSplitKeys(dynamicPropertyIds: string[]): { inboxIds: string[]; outboxIds: string[]; cooldownIds: string[] } {
  const inboxIds: string[] = [];
  const outboxIds: string[] = [];
  const cooldownIds: string[] = [];
  for (const key of dynamicPropertyIds) {
    if (key.startsWith(TPA_INBOX_PREFIX)) inboxIds.push(key.slice(TPA_INBOX_PREFIX.length));
    else if (key.startsWith(TPA_OUTBOX_PREFIX)) outboxIds.push(key.slice(TPA_OUTBOX_PREFIX.length));
    else if (key.startsWith(TPA_COOLDOWN_PREFIX)) cooldownIds.push(key.slice(TPA_COOLDOWN_PREFIX.length));
  }
  return { inboxIds, outboxIds, cooldownIds };
}

export function clearTpaInboxFor(playerId: string): void {
  const key = inboxKey(playerId);
  world.setDynamicProperty(key, undefined);
  persisted.delete(key);
  persistedInboxKeys.delete(key);
}

export function clearTpaOutboxFor(playerId: string): void {
  const key = outboxKey(playerId);
  world.setDynamicProperty(key, undefined);
  persisted.delete(key);
  persistedOutboxKeys.delete(key);
}

export function clearTpaCooldownFor(playerId: string): void {
  const key = cooldownKey(playerId);
  world.setDynamicProperty(key, undefined);
  persisted.delete(key);
  persistedCooldownKeys.delete(key);
}

export function clearAllTpaForPlayer(playerId: string): void {
  clearTpaInboxFor(playerId);
  clearTpaOutboxFor(playerId);
  clearTpaCooldownFor(playerId);
}

export function tpaInboxPlayerIds(dynamicPropertyIds: string[] = world.getDynamicPropertyIds()): string[] {
  return dynamicPropertyIds
    .filter((key) => key.startsWith(TPA_INBOX_PREFIX))
    .map((key) => key.slice(TPA_INBOX_PREFIX.length))
    .filter((id) => id.length > 0);
}

export function tpaOutboxPlayerIds(dynamicPropertyIds: string[] = world.getDynamicPropertyIds()): string[] {
  return dynamicPropertyIds
    .filter((key) => key.startsWith(TPA_OUTBOX_PREFIX))
    .map((key) => key.slice(TPA_OUTBOX_PREFIX.length))
    .filter((id) => id.length > 0);
}

export function ensureTpaDefaults(): void {
  if (persistedInboxKeys.size === 0) {
    for (const id of tpaInboxPlayerIds()) persistedInboxKeys.add(inboxKey(id));
  }
  if (persistedOutboxKeys.size === 0) {
    for (const id of tpaOutboxPlayerIds()) persistedOutboxKeys.add(outboxKey(id));
  }
  if (persistedCooldownKeys.size === 0) {
    for (const id of tpaInboxPlayerIds()) persistedCooldownKeys.add(cooldownKey(id));
  }
}

export function directSaveTpaInbox(playerId: string, requests: TpaRequest[]): boolean {
  return safeSetDynamicJson(inboxKey(playerId), requests);
}

export function directSaveTpaOutbox(playerId: string, requests: TpaRequest[]): boolean {
  return safeSetDynamicJson(outboxKey(playerId), requests);
}

export function directSaveTpaCooldown(playerId: string, untilMs: number): boolean {
  return safeSetDynamicJson(cooldownKey(playerId), untilMs);
}
