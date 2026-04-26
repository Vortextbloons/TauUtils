import { world } from "@minecraft/server";
import { getPlayerId, getScore, saveHomes, savePay, savePlayerSettings, saveTpa, setScore, state, } from "./storage";
const tpaPendingByTargetId = {};
const tpaCooldownBySenderId = {};
const payCooldownBySenderId = {};
function nowMs() {
    return Date.now();
}
function getPlayerSettingsById(playerId) {
    const existing = state.playerSettings.players[playerId];
    if (existing)
        return existing;
    const created = {
        allowTpa: state.playerSettings.config.defaultAllowTpa,
        allowPay: state.playerSettings.config.defaultAllowPay,
        showSocialMessages: state.playerSettings.config.defaultShowSocialMessages,
    };
    state.playerSettings.players[playerId] = created;
    savePlayerSettings();
    return created;
}
export function getPlayerSettings(player) {
    return getPlayerSettingsById(getPlayerId(player));
}
export function updatePlayerSettings(player, partial) {
    const current = getPlayerSettings(player);
    state.playerSettings.players[getPlayerId(player)] = { ...current, ...partial };
    savePlayerSettings();
}
export function updateTpaConfig(partial) {
    state.tpa.config = { ...state.tpa.config, ...partial };
    saveTpa();
}
export function updateHomesConfig(partial) {
    state.homes.config = { ...state.homes.config, ...partial };
    saveHomes();
}
export function updatePayConfig(partial) {
    state.pay.config = { ...state.pay.config, ...partial };
    savePay();
}
export function updatePlayerSettingsConfig(partial) {
    state.playerSettings.config = { ...state.playerSettings.config, ...partial };
    savePlayerSettings();
}
export function createTpaRequest(from, to) {
    if (!state.tpa.config.enabled)
        return { ok: false, message: "TPA is disabled." };
    if (from.id === to.id)
        return { ok: false, message: "You cannot send a TPA request to yourself." };
    const toSettings = getPlayerSettings(to);
    if (!toSettings.allowTpa)
        return { ok: false, message: `${to.name} is not accepting TPA requests.` };
    const senderId = getPlayerId(from);
    const targetId = getPlayerId(to);
    const cooldownUntil = tpaCooldownBySenderId[senderId] ?? 0;
    const now = nowMs();
    if (cooldownUntil > now) {
        const seconds = Math.ceil((cooldownUntil - now) / 1000);
        return { ok: false, message: `TPA cooldown: ${seconds}s.` };
    }
    tpaPendingByTargetId[targetId] = {
        fromPlayerId: senderId,
        fromName: from.name,
        toPlayerId: targetId,
        expiresAt: now + Math.max(5, state.tpa.config.timeoutSeconds) * 1000,
    };
    tpaCooldownBySenderId[senderId] = now + Math.max(1, state.tpa.config.cooldownSeconds) * 1000;
    return { ok: true, message: `Sent TPA request to ${to.name}.` };
}
export function acceptTpaRequest(target) {
    const targetId = getPlayerId(target);
    const req = tpaPendingByTargetId[targetId];
    if (!req)
        return { ok: false, message: "No pending TPA request." };
    delete tpaPendingByTargetId[targetId];
    if (req.expiresAt < nowMs())
        return { ok: false, message: "TPA request expired." };
    const requester = world.getAllPlayers().find((p) => getPlayerId(p) === req.fromPlayerId);
    if (!requester)
        return { ok: false, message: `${req.fromName} is not online.` };
    requester.teleport(target.location, { dimension: target.dimension });
    return { ok: true, message: `${req.fromName} teleported to you.`, requesterName: req.fromName };
}
export function denyTpaRequest(target) {
    const targetId = getPlayerId(target);
    const req = tpaPendingByTargetId[targetId];
    if (!req)
        return { ok: false, message: "No pending TPA request." };
    delete tpaPendingByTargetId[targetId];
    return { ok: true, message: "TPA request denied.", requesterName: req.fromName };
}
export function setHome(player, rawName) {
    if (!state.homes.config.enabled)
        return { ok: false, message: "Homes are disabled." };
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
export function listHomes(player) {
    const homes = state.homes.homesByPlayerId[getPlayerId(player)] ?? {};
    return Object.keys(homes).sort((a, b) => a.localeCompare(b));
}
export function deleteHome(player, rawName) {
    const name = String(rawName ?? "home").trim().toLowerCase() || "home";
    const playerId = getPlayerId(player);
    const homes = state.homes.homesByPlayerId[playerId] ?? {};
    if (!homes[name])
        return { ok: false, message: `Home "${name}" not found.` };
    delete homes[name];
    state.homes.homesByPlayerId[playerId] = homes;
    saveHomes();
    return { ok: true, message: `Home "${name}" deleted.` };
}
export function teleportHome(player, rawName) {
    if (!state.homes.config.enabled)
        return { ok: false, message: "Homes are disabled." };
    const name = String(rawName ?? "home").trim().toLowerCase() || "home";
    const homes = state.homes.homesByPlayerId[getPlayerId(player)] ?? {};
    const home = homes[name];
    if (!home)
        return { ok: false, message: `Home "${name}" not found.` };
    if (!state.homes.config.allowCrossDimension && player.dimension.id !== home.dimensionId) {
        return { ok: false, message: "Cross-dimension homes are disabled." };
    }
    const dimension = world.getDimension(home.dimensionId);
    player.teleport({ x: home.x, y: home.y, z: home.z }, { dimension });
    return { ok: true, message: `Teleported to "${name}".` };
}
export function payPlayer(from, to, amountRaw) {
    if (!state.pay.config.enabled)
        return { ok: false, message: "Pay is disabled." };
    if (from.id === to.id)
        return { ok: false, message: "You cannot pay yourself." };
    const amount = Math.floor(amountRaw);
    if (!Number.isFinite(amount) || amount < state.pay.config.minAmount) {
        return { ok: false, message: `Minimum payment is ${state.pay.config.minAmount}.` };
    }
    if (amount > state.pay.config.maxAmount) {
        return { ok: false, message: `Maximum payment is ${state.pay.config.maxAmount}.` };
    }
    const toSettings = getPlayerSettings(to);
    if (!toSettings.allowPay)
        return { ok: false, message: `${to.name} is not accepting payments.` };
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
    if (senderBalance < amount)
        return { ok: false, message: "Not enough balance." };
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
