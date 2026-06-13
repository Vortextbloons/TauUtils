import { Player, world } from "@minecraft/server";
import { getOnlinePlayerById, getPlayerId, isFeatureEnabled, saveReferrals, state, tell } from "../storage";
import { runCustomReward } from "../custom-rewards";
import { type ReferralPlayerRecord } from "../types";

const REFERRAL_CODE_LENGTH = 6;

export type ReferralResult = {
  ok: boolean;
  message: string;
};

function generateCode(): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const code = Math.floor(Math.random() * 10 ** REFERRAL_CODE_LENGTH).toString().padStart(REFERRAL_CODE_LENGTH, "0");
    if (!state.referrals.codeToPlayerId[code]) return code;
  }
  return `${Date.now() % 10 ** REFERRAL_CODE_LENGTH}`.padStart(REFERRAL_CODE_LENGTH, "0");
}

export function getOrCreateReferralRecord(player: Player): ReferralPlayerRecord {
  const playerId = getPlayerId(player);
  let record = state.referrals.players[playerId];
  if (!record) {
    const code = generateCode();
    record = {
      code,
      redeemedCodes: [],
      referredByPlayerIds: [],
      referralCount: 0,
      pendingRewardIds: [],
      lastKnownName: player.name,
    };
    state.referrals.players[playerId] = record;
    state.referrals.codeToPlayerId[code] = playerId;
    saveReferrals();
  }
  record.pendingRewardIds ??= [];
  record.redeemedCodes ??= [];
  record.referredByPlayerIds ??= [];
  record.referralCount = Math.max(0, Math.floor(Number(record.referralCount) || 0));
  record.lastKnownName = player.name;
  if (!record.code || state.referrals.codeToPlayerId[record.code] !== playerId) {
    if (record.code) delete state.referrals.codeToPlayerId[record.code];
    record.code = generateCode();
    state.referrals.codeToPlayerId[record.code] = playerId;
    saveReferrals();
  }
  return record;
}

function runRewardIds(player: Player, rewardIds: string[], extra: Record<string, string | number | boolean | undefined>): void {
  for (const rewardId of rewardIds) runCustomReward(player, rewardId, { internal: true, extra });
}

export function flushPendingReferralRewards(player: Player): void {
  if (!isFeatureEnabled("referrals") || !state.referrals.config.enabled) return;
  const record = getOrCreateReferralRecord(player);
  if (record.pendingRewardIds.length === 0) return;
  const rewardIds = [...record.pendingRewardIds];
  record.pendingRewardIds = [];
  runRewardIds(player, rewardIds, { player: player.name });
  saveReferrals();
  tell(player, `§aYou received ${rewardIds.length} pending referral reward(s).`);
}

export function redeemReferralCode(player: Player, rawCode: string): ReferralResult {
  if (!isFeatureEnabled("referrals") || !state.referrals.config.enabled) return { ok: false, message: "Referrals are disabled." };
  const code = String(rawCode ?? "").replace(/\D/g, "");
  if (code.length !== REFERRAL_CODE_LENGTH) return { ok: false, message: `Referral codes must be ${REFERRAL_CODE_LENGTH} digits.` };

  const referrerPlayerId = state.referrals.codeToPlayerId[code];
  if (!referrerPlayerId) return { ok: false, message: "Referral code not found." };

  const refereePlayerId = getPlayerId(player);
  if (refereePlayerId === referrerPlayerId) return { ok: false, message: "You cannot redeem your own referral code." };

  const refereeRecord = getOrCreateReferralRecord(player);
  if (!state.referrals.config.allowMultipleRedemptions && refereeRecord.redeemedCodes.length > 0) {
    return { ok: false, message: "You have already redeemed a referral code." };
  }
  const maxReferrals = Math.max(1, Math.floor(Number(state.referrals.config.maxReferralsPerPlayer) || 1));
  if (refereeRecord.referredByPlayerIds.length >= maxReferrals) {
    return { ok: false, message: `You can only redeem ${maxReferrals} referral code(s).` };
  }
  const cooldownMs = Math.max(0, Math.floor(Number(state.referrals.config.cooldownSeconds) || 0)) * 1000;
  const now = Date.now();
  if (cooldownMs > 0 && refereeRecord.lastRedemptionAt && now - refereeRecord.lastRedemptionAt < cooldownMs) {
    const secondsLeft = Math.ceil((cooldownMs - (now - refereeRecord.lastRedemptionAt)) / 1000);
    return { ok: false, message: `Wait ${secondsLeft}s before redeeming another referral code.` };
  }
  if (refereeRecord.redeemedCodes.includes(code) || refereeRecord.referredByPlayerIds.includes(referrerPlayerId)) {
    return { ok: false, message: "You have already redeemed this referral." };
  }

  const referrer = getOnlinePlayerById(referrerPlayerId);
  const referrerRecord = referrer ? getOrCreateReferralRecord(referrer) : state.referrals.players[referrerPlayerId];
  if (!referrerRecord) return { ok: false, message: "Referral owner data is missing." };

  refereeRecord.redeemedCodes.push(code);
  refereeRecord.referredByPlayerIds.push(referrerPlayerId);
  refereeRecord.lastRedemptionAt = now;
  referrerRecord.referralCount = Math.max(0, Number(referrerRecord.referralCount) || 0) + 1;

  const referrerName = referrer?.name ?? referrerRecord.lastKnownName ?? "Unknown";
  const extra = { referee: player.name, referrer: referrerName, code };
  runRewardIds(player, state.referrals.config.refereeRewardIds, extra);
  if (referrer) runRewardIds(referrer, state.referrals.config.referrerRewardIds, extra);
  else referrerRecord.pendingRewardIds.push(...state.referrals.config.referrerRewardIds);

  state.referrals.redemptions.unshift({
    refereePlayerId,
    refereeName: player.name,
    referrerPlayerId,
    referrerName,
    code,
    redeemedAt: now,
  });
  state.referrals.redemptions = state.referrals.redemptions.slice(0, Math.max(1, state.referrals.config.maxRedemptionHistory));
  saveReferrals();

  tell(player, `§aReferral accepted. You were referred by ${referrerName}.`);
  if (referrer) tell(referrer, `§a${player.name} used your referral code.`);
  if (state.referrals.config.broadcastMessage) world.sendMessage(`§6[Tau]§a ${player.name} joined through ${referrerName}'s referral code.`);
  return { ok: true, message: "Referral redeemed." };
}

export function getTopReferralRows(limit = 10): string[] {
  return Object.entries(state.referrals.players)
    .sort(([, a], [, b]) => (b.referralCount ?? 0) - (a.referralCount ?? 0))
    .slice(0, limit)
    .map(([, record], index) => `${index + 1}. ${record.lastKnownName || "Unknown"}: ${record.referralCount ?? 0}`);
}
