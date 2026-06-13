import { Player, world } from "@minecraft/server";
import {
  getOnlinePlayerById,
  getPlayerId,
  getScore,
  saveHomes,
  savePay,
  savePlayerSettings,
  saveTpa,
  saveTpaCooldownFor,
  saveTpaInboxFor,
  saveTpaOutboxFor,
  setScore,
  state,
  clearAllTpaForPlayer,
  readTpaCooldown,
  readTpaInbox,
  readTpaOutbox,
} from "../storage";
import { canTeleportTo } from "../shared/teleport-guard";
import type { TpaRequest } from "../types";

const payCooldownBySenderId: Record<string, number> = {};
const tpaNotifySubscribers = new Set<(playerId: string, request: TpaRequest) => void>();

function nowMs(): number {
  return Date.now();
}

function generateRequestId(): string {
  return `tpa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getPlayerSettingsById(playerId: string) {
  const existing = state.playerSettings.players[playerId];
  if (existing) return existing;
  const created = {
    allowTpa: state.playerSettings.config.defaultAllowTpa,
    allowPay: state.playerSettings.config.defaultAllowPay,
    showSocialMessages: state.playerSettings.config.defaultShowSocialMessages,
  };
  state.playerSettings.players[playerId] = created;
  savePlayerSettings();
  return created;
}

export function getPlayerSettings(player: Player) {
  return getPlayerSettingsById(getPlayerId(player));
}

export function updatePlayerSettings(player: Player, partial: Partial<{ allowTpa: boolean; allowPay: boolean; showSocialMessages: boolean }>) {
  const current = getPlayerSettings(player);
  state.playerSettings.players[getPlayerId(player)] = { ...current, ...partial };
  savePlayerSettings();
}

export function updateTpaConfig(partial: Partial<typeof state.tpa.config>) {
  state.tpa.config = { ...state.tpa.config, ...partial };
  saveTpa();
}

export function updateHomesConfig(partial: Partial<typeof state.homes.config>) {
  state.homes.config = { ...state.homes.config, ...partial };
  saveHomes();
}

export function updatePayConfig(partial: Partial<typeof state.pay.config>) {
  state.pay.config = { ...state.pay.config, ...partial };
  savePay();
}

export function updatePlayerSettingsConfig(partial: Partial<typeof state.playerSettings.config>) {
  state.playerSettings.config = { ...state.playerSettings.config, ...partial };
  savePlayerSettings();
}

function purgeExpired(requests: TpaRequest[], now: number): TpaRequest[] {
  return requests.filter((req) => req.expiresAt > now);
}

export function listIncomingTpaRequests(target: Player): TpaRequest[] {
  const now = nowMs();
  const inbox = purgeExpired(readTpaInbox(getPlayerId(target)), now);
  return inbox.sort((a, b) => a.createdAt - b.createdAt);
}

export function listOutgoingTpaRequests(from: Player): TpaRequest[] {
  const now = nowMs();
  const outbox = purgeExpired(readTpaOutbox(getPlayerId(from)), now);
  return outbox.sort((a, b) => a.createdAt - b.createdAt);
}

export function onTpaIncomingRequest(handler: (playerId: string, request: TpaRequest) => void): () => void {
  tpaNotifySubscribers.add(handler);
  return () => {
    tpaNotifySubscribers.delete(handler);
  };
}

function emitTpaIncoming(targetId: string, request: TpaRequest): void {
  for (const handler of tpaNotifySubscribers) {
    try {
      handler(targetId, request);
    } catch {
      // Swallow subscriber errors so one bad handler does not block others.
    }
  }
}

export function createTpaRequest(from: Player, to: Player): { ok: boolean; message: string; request?: TpaRequest } {
  if (!state.tpa.config.enabled) return { ok: false, message: "TPA is disabled." };
  if (from.id === to.id) return { ok: false, message: "You cannot send a TPA request to yourself." };

  const toSettings = getPlayerSettings(to);
  if (!toSettings.allowTpa) return { ok: false, message: `${to.name} is not accepting TPA requests.` };

  const senderId = getPlayerId(from);
  const targetId = getPlayerId(to);
  const now = nowMs();
  const cooldownUntil = readTpaCooldown(senderId);
  if (cooldownUntil > now) {
    const seconds = Math.ceil((cooldownUntil - now) / 1000);
    return { ok: false, message: `TPA cooldown: ${seconds}s.` };
  }

  const incoming = purgeExpired(readTpaInbox(targetId), now);
  if (incoming.some((req) => req.fromPlayerId === senderId)) {
    return { ok: false, message: `${to.name} already has a pending TPA request from you.` };
  }

  const request: TpaRequest = {
    requestId: generateRequestId(),
    fromPlayerId: senderId,
    fromName: from.name,
    toPlayerId: targetId,
    toName: to.name,
    createdAt: now,
    expiresAt: now + Math.max(5, state.tpa.config.timeoutSeconds) * 1000,
  };

  incoming.push(request);
  saveTpaInboxFor(targetId, incoming);

  const outgoing = purgeExpired(readTpaOutbox(senderId), now).filter((req) => req.toPlayerId !== targetId);
  outgoing.push(request);
  saveTpaOutboxFor(senderId, outgoing);

  saveTpaCooldownFor(senderId, now + Math.max(1, state.tpa.config.cooldownSeconds) * 1000);

  emitTpaIncoming(targetId, request);

  return { ok: true, message: `Sent TPA request to ${to.name}.`, request };
}

function popRequestFromInbox(targetId: string, requestId: string | undefined): { request: TpaRequest | undefined; inbox: TpaRequest[] } {
  const now = nowMs();
  const inbox = purgeExpired(readTpaInbox(targetId), now);
  if (inbox.length === 0) return { request: undefined, inbox: [] };

  const index = requestId
    ? inbox.findIndex((req) => req.requestId === requestId)
    : 0;
  if (index < 0 || index >= inbox.length) return { request: undefined, inbox };

  const [request] = inbox.splice(index, 1);
  return { request, inbox };
}

function removeRequestFromOutbox(senderId: string, requestId: string): TpaRequest[] {
  const now = nowMs();
  const outbox = purgeExpired(readTpaOutbox(senderId), now);
  const filtered = outbox.filter((req) => req.requestId !== requestId);
  if (filtered.length !== outbox.length) saveTpaOutboxFor(senderId, filtered);
  return filtered;
}

export function acceptTpaRequest(target: Player, requestId?: string): { ok: boolean; message: string; requesterName?: string } {
  const targetId = getPlayerId(target);
  const { request, inbox } = popRequestFromInbox(targetId, requestId);
  if (!request) return { ok: false, message: "No pending TPA request." };
  saveTpaInboxFor(targetId, inbox);

  if (request.expiresAt < nowMs()) return { ok: false, message: "TPA request expired." };
  const requester = getOnlinePlayerById(request.fromPlayerId);
  if (!requester) return { ok: false, message: `${request.fromName} is not online.` };
  const guard = canTeleportTo(requester, { ...target.location, dimensionId: target.dimension.id }, { blockCombat: true });
  if (!guard.ok) return guard;

  requester.teleport(target.location, { dimension: target.dimension });

  removeRequestFromOutbox(request.fromPlayerId, request.requestId);

  return { ok: true, message: `${request.fromName} teleported to you.`, requesterName: request.fromName };
}

export function denyTpaRequest(target: Player, requestId?: string): { ok: boolean; message: string; requesterName?: string } {
  const targetId = getPlayerId(target);
  const { request, inbox } = popRequestFromInbox(targetId, requestId);
  if (!request) return { ok: false, message: "No pending TPA request." };
  saveTpaInboxFor(targetId, inbox);

  removeRequestFromOutbox(request.fromPlayerId, request.requestId);

  return { ok: true, message: "TPA request denied.", requesterName: request.fromName };
}

export function cancelOutgoingTpaRequest(from: Player, requestId: string): { ok: boolean; message: string } {
  const senderId = getPlayerId(from);
  const now = nowMs();
  const outbox = purgeExpired(readTpaOutbox(senderId), now);
  const request = outbox.find((req) => req.requestId === requestId);
  if (!request) return { ok: false, message: "TPA request not found." };

  const filtered = outbox.filter((req) => req.requestId !== requestId);
  if (filtered.length !== outbox.length) saveTpaOutboxFor(senderId, filtered);

  const targetInbox = purgeExpired(readTpaInbox(request.toPlayerId), now);
  const filteredTarget = targetInbox.filter((req) => req.requestId !== requestId);
  if (filteredTarget.length !== targetInbox.length) saveTpaInboxFor(request.toPlayerId, filteredTarget);

  return { ok: true, message: "TPA request cancelled." };
}

export function clearSocialRuntimeForPlayer(playerId: string): void {
  delete payCooldownBySenderId[playerId];
  clearAllTpaForPlayer(playerId);
}

export function setHome(player: Player, rawName?: string): { ok: boolean; message: string } {
  if (!state.homes.config.enabled) return { ok: false, message: "Homes are disabled." };
  const name = String(rawName ?? "home").trim().toLowerCase() || "home";
  const playerId = getPlayerId(player);
  const homes = state.homes.homesByPlayerId[playerId] ?? {};
  if (!homes[name] && Object.keys(homes).length >= Math.max(1, state.homes.config.maxHomesDefault)) {
    return { ok: false, message: `Max homes reached (${state.homes.config.maxHomesDefault}).` };
  }
  homes[name] = {
    x: player.location.x,
    y: player.location.y,
    z: player.location.z,
    dimensionId: player.dimension.id,
  };
  state.homes.homesByPlayerId[playerId] = homes;
  saveHomes();
  return { ok: true, message: `Home "${name}" set.` };
}

export function listHomes(player: Player): string[] {
  const homes = state.homes.homesByPlayerId[getPlayerId(player)] ?? {};
  return Object.keys(homes).sort((a, b) => a.localeCompare(b));
}

export function deleteHome(player: Player, rawName?: string): { ok: boolean; message: string } {
  const name = String(rawName ?? "home").trim().toLowerCase() || "home";
  const playerId = getPlayerId(player);
  const homes = state.homes.homesByPlayerId[playerId] ?? {};
  if (!homes[name]) return { ok: false, message: `Home "${name}" not found.` };
  delete homes[name];
  state.homes.homesByPlayerId[playerId] = homes;
  saveHomes();
  return { ok: true, message: `Home "${name}" deleted.` };
}

export function teleportHome(player: Player, rawName?: string): { ok: boolean; message: string } {
  if (!state.homes.config.enabled) return { ok: false, message: "Homes are disabled." };
  const name = String(rawName ?? "home").trim().toLowerCase() || "home";
  const homes = state.homes.homesByPlayerId[getPlayerId(player)] ?? {};
  const home = homes[name];
  if (!home) return { ok: false, message: `Home "${name}" not found.` };
  if (!state.homes.config.allowCrossDimension && player.dimension.id !== home.dimensionId) {
    return { ok: false, message: "Cross-dimension homes are disabled." };
  }
  const guard = canTeleportTo(player, { ...home, dimensionId: home.dimensionId }, { blockCombat: true });
  if (!guard.ok) return guard;
  const dimension = world.getDimension(home.dimensionId);
  player.teleport({ x: home.x, y: home.y, z: home.z }, { dimension });
  return { ok: true, message: `Teleported to "${name}".` };
}

export function payPlayer(from: Player, to: Player, amountRaw: number): { ok: boolean; message: string } {
  if (!state.pay.config.enabled) return { ok: false, message: "Pay is disabled." };
  if (from.id === to.id) return { ok: false, message: "You cannot pay yourself." };

  const amount = Math.floor(amountRaw);
  if (!Number.isFinite(amount) || amount < state.pay.config.minAmount) {
    return { ok: false, message: `Minimum payment is ${state.pay.config.minAmount}.` };
  }
  if (amount > state.pay.config.maxAmount) {
    return { ok: false, message: `Maximum payment is ${state.pay.config.maxAmount}.` };
  }

  const toSettings = getPlayerSettings(to);
  if (!toSettings.allowPay) return { ok: false, message: `${to.name} is not accepting payments.` };

  const senderId = getPlayerId(from);
  const now = nowMs();
  const cooldownUntil = payCooldownBySenderId[senderId] ?? 0;
  if (cooldownUntil > now) {
    const seconds = Math.ceil((cooldownUntil - now) / 1000);
    return { ok: false, message: `Pay cooldown: ${seconds}s.` };
  }

  const objective = state.pay.config.currencyObjective;
  const senderBalance = getScore(from, objective);
  const receiverBalance = getScore(to, objective);
  if (senderBalance === undefined || receiverBalance === undefined) {
    return { ok: false, message: `Missing scoreboard objective "${objective}".` };
  }
  if (senderBalance < amount) return { ok: false, message: "Not enough balance." };

  const tax = Math.floor((amount * Math.max(0, state.pay.config.taxPercent)) / 100);
  const received = Math.max(0, amount - tax);
  if (!setScore(from, objective, senderBalance - amount)) {
    return { ok: false, message: "Failed to update sender balance." };
  }
  if (!setScore(to, objective, receiverBalance + received)) {
    setScore(from, objective, senderBalance);
    return { ok: false, message: "Failed to update receiver balance." };
  }

  payCooldownBySenderId[senderId] = now + Math.max(1, state.pay.config.cooldownSeconds) * 1000;
  return { ok: true, message: `Paid ${to.name} ${received}${tax > 0 ? ` (tax ${tax})` : ""}.` };
}
