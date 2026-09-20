import {
  Entity,
  EntityComponentTypes,
  EquipmentSlot,
  type EntityDamageSource,
  ItemStack,
  Player,
  system,
  world,
} from "@minecraft/server";
import { asPlayer, getInventoryContainer, getPlayerId, getPlayerRank, getScore, isFeatureEnabled, journalAck, journalAppend, journalHead, saveCombat, setScore, state, tell } from "../storage";
import { safeSetDynamicJson, readDynamicJSON } from "../storage/dynamic-json";
import { serializeItemStack, deserializeItemStack } from "../shared/item-serialization";
import type { SerializedItemStack } from "../types";
import { invalidatePlayerSidebarCache } from "../sidebar";
import { runBuiltCommandFromConfiguredCommand } from "../command-builder";
import { combatTagsByPlayerId, hasActiveCombatTag, isCombatFeatureActive, isPlayerInCombat } from "./status";
import { renderCommandTemplate, renderTemplate } from "../shared/templates";
import type { CombatConfig, KillConditionAction, KillConditionRule, PlayerStats } from "../types";

type CombatLootSnapshot = {
  inventory: ItemStack[];
  equipment: ItemStack[];
};

type PendingCombatLogout = {
  playerId: string;
  playerName: string;
  dimensionId: string;
  location: { x: number; y: number; z: number };
  inventory: ItemStack[];
  equipment: ItemStack[];
  attempts: number;
  journalSeq?: number;
};

type CombatKillContext = {
  killerStats: PlayerStats;
  killstreak: number;
};

const combatSnapshotsByPlayerId = new Map<string, CombatLootSnapshot>();
const pendingCombatLogouts: PendingCombatLogout[] = [];
const lastCombatSnapshotAtByPlayerId = new Map<string, number>();
let pendingCombatLogoutsJobId: number | undefined;
let combatTagsJobId: number | undefined;
const PENALTY_KEY_PREFIX = "tau:combat:penalty:";
const COMBAT_LOGOUT_PREFIX = "tau:combat:logout:";
const COMBAT_SNAPSHOT_INTERVAL_MS = 3000;
const EQUIPMENT_SLOTS: EquipmentSlot[] = [
  EquipmentSlot.Head,
  EquipmentSlot.Chest,
  EquipmentSlot.Legs,
  EquipmentSlot.Feet,
  EquipmentSlot.Offhand,
];

function nowMs(): number {
  return Date.now();
}

function penaltyKey(playerId: string): string {
  return `${PENALTY_KEY_PREFIX}${playerId}`;
}

function combatLogoutKey(playerId: string): string {
  return `${COMBAT_LOGOUT_PREFIX}${playerId}`;
}

type PersistedCombatLogout = {
  playerId: string;
  playerName: string;
  dimensionId: string;
  location: { x: number; y: number; z: number };
  inventory: SerializedItemStack[];
  equipment: SerializedItemStack[];
  attempts: number;
};

function persistCombatLogout(entry: PendingCombatLogout): void {
  try {
    const persisted: PersistedCombatLogout = {
      playerId: entry.playerId,
      playerName: entry.playerName,
      dimensionId: entry.dimensionId,
      location: entry.location,
      inventory: entry.inventory.map((stack) => serializeItemStack(stack)),
      equipment: entry.equipment.map((stack) => serializeItemStack(stack)),
      attempts: entry.attempts,
    };
    safeSetDynamicJson(combatLogoutKey(entry.playerId), persisted);
  } catch {
    // RAM queue remains as fallback
  }
}

function clearPersistedCombatLogout(playerId: string): void {
  try {
    world.setDynamicProperty(combatLogoutKey(playerId), undefined);
  } catch {
    // ignore
  }
}

let restoredPersistedCombatLogouts = false;

function restorePersistedCombatLogouts(): void {
  if (restoredPersistedCombatLogouts) return;
  restoredPersistedCombatLogouts = true;
  let ids: string[] = [];
  try {
    ids = world.getDynamicPropertyIds();
  } catch {
    return;
  }
  for (const key of ids) {
    if (!key.startsWith(COMBAT_LOGOUT_PREFIX)) continue;
    const playerId = key.slice(COMBAT_LOGOUT_PREFIX.length);
    if (!playerId) continue;
    if (pendingCombatLogouts.some((entry) => entry.playerId === playerId)) continue;
    const persisted = readDynamicJSON<PersistedCombatLogout | undefined>(key, undefined);
    if (!persisted) continue;
    try {
      const inventory = (persisted.inventory ?? []).map((data) => deserializeItemStack(data));
      const equipment = (persisted.equipment ?? []).map((data) => deserializeItemStack(data));
      if (inventory.length + equipment.length === 0) {
        clearPersistedCombatLogout(playerId);
        continue;
      }
      pendingCombatLogouts.push({
        playerId: persisted.playerId || playerId,
        playerName: persisted.playerName || "Player",
        dimensionId: persisted.dimensionId,
        location: persisted.location,
        inventory,
        equipment,
        attempts: Math.max(0, Math.floor(persisted.attempts ?? 0)),
      });
    } catch {
      continue;
    }
  }
}

function formatCombatMessage(template: string, playerName: string): string {
  return renderTemplate(template, { extra: { player: playerName } });
}

function getCombatDurationMs(): number {
  const seconds = Math.max(1, Math.floor(Number(state.combat.config.combatTimeSeconds ?? 15)));
  return seconds * 1000;
}

function isCombatSystemEnabled(): boolean {
  return isCombatFeatureActive();
}

function clearCombatTag(player: Player, playerId: string, notify: boolean): void {
  combatTagsByPlayerId.delete(playerId);
  combatSnapshotsByPlayerId.delete(playerId);
  lastCombatSnapshotAtByPlayerId.delete(playerId);
  invalidatePlayerSidebarCache(player);
  if (!notify) return;
  tell(player, state.combat.config.exitMessage);
}

function isTagged(player: Player, playerId: string): boolean {
  const entry = combatTagsByPlayerId.get(playerId);
  if (!entry) return false;
  if (entry.expiresAt > nowMs()) return true;
  clearCombatTag(player, playerId, true);
  return false;
}

function hasActiveTag(playerId: string): boolean {
  const active = hasActiveCombatTag(playerId, nowMs());
  if (!active) {
    combatSnapshotsByPlayerId.delete(playerId);
    lastCombatSnapshotAtByPlayerId.delete(playerId);
  }
  return active;
}

function setCombatTag(player: Player): void {
  const id = getPlayerId(player);
  const tagged = isTagged(player, id);
  const now = nowMs();
  combatTagsByPlayerId.set(id, { expiresAt: now + getCombatDurationMs() });
  const lastSnapshotAt = lastCombatSnapshotAtByPlayerId.get(id) ?? 0;
  const cached = combatSnapshotsByPlayerId.get(id);
  if (!tagged || now - lastSnapshotAt >= COMBAT_SNAPSHOT_INTERVAL_MS || !cached) {
    if (cached && combatSnapshotItemCount(cached) > 0) {
      const live = scanCombatLootFingerprint(player);
      if (live.count > 0 && live.hash === combatSnapshotContentHash(cached)) {
        lastCombatSnapshotAtByPlayerId.set(id, now);
      } else {
        combatSnapshotsByPlayerId.set(id, captureCombatLoot(player));
        lastCombatSnapshotAtByPlayerId.set(id, now);
      }
    } else {
      combatSnapshotsByPlayerId.set(id, captureCombatLoot(player));
      lastCombatSnapshotAtByPlayerId.set(id, now);
    }
  }
  if (!tagged) {
    tell(player, state.combat.config.enterMessage);
    invalidatePlayerSidebarCache(player);
  }
}

function captureCombatLoot(player: Player): CombatLootSnapshot {
  const inventory: ItemStack[] = [];
  const equipment: ItemStack[] = [];

  const container = getInventoryContainer(player);
  if (container) {
    for (let slot = 0; slot < container.size; slot++) {
      try {
        const stack = container.getItem(slot);
        if (!stack) continue;
        inventory.push(stack.clone());
      } catch {
        continue;
      }
    }
  }

  try {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (equippable) {
      for (const slotType of EQUIPMENT_SLOTS) {
        try {
          const stack = equippable.getEquipment(slotType);
          if (!stack) continue;
          equipment.push(stack.clone());
        } catch {
          continue;
        }
      }
    }
  } catch {
  }

  return { inventory, equipment };
}

function cloneCombatLoot(snapshot: CombatLootSnapshot): CombatLootSnapshot {
  return {
    inventory: snapshot.inventory.map((stack) => stack.clone()),
    equipment: snapshot.equipment.map((stack) => stack.clone()),
  };
}

function combatSnapshotItemCount(snapshot: CombatLootSnapshot): number {
  return snapshot.inventory.length + snapshot.equipment.length;
}

function mixCombatFingerprint(hash: number, typeId: string, amount: number, nameTag?: string): number {
  for (let i = 0; i < typeId.length; i++) {
    hash = (Math.imul(hash, 31) + typeId.charCodeAt(i)) | 0;
  }
  hash = (Math.imul(hash, 31) + amount) | 0;
  const tag = String(nameTag ?? "");
  for (let i = 0; i < tag.length; i++) {
    hash = (Math.imul(hash, 31) + tag.charCodeAt(i)) | 0;
  }
  return hash | 0;
}

function scanCombatLootFingerprint(player: Player): { count: number; hash: string } {
  let count = 0;
  let hash = 0;
  const container = getInventoryContainer(player);
  if (container) {
    for (let slot = 0; slot < container.size; slot++) {
      try {
        const stack = container.getItem(slot);
        if (!stack) continue;
        count += 1;
        hash = mixCombatFingerprint(hash, stack.typeId, stack.amount, stack.nameTag);
      } catch {
        continue;
      }
    }
  }

  try {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (equippable) {
      for (const slotType of EQUIPMENT_SLOTS) {
        try {
          const stack = equippable.getEquipment(slotType);
          if (!stack) continue;
          count += 1;
          hash = mixCombatFingerprint(hash, stack.typeId, stack.amount, stack.nameTag);
        } catch {
          continue;
        }
      }
    }
  } catch {
  }
  return { count, hash: `${count}:${hash}` };
}

function combatSnapshotContentHash(snapshot: CombatLootSnapshot): string {
  let hash = 0;
  for (const stack of snapshot.inventory) {
    try {
      hash = mixCombatFingerprint(hash, stack.typeId, stack.amount, stack.nameTag);
    } catch {
      continue;
    }
  }
  for (const stack of snapshot.equipment) {
    try {
      hash = mixCombatFingerprint(hash, stack.typeId, stack.amount, stack.nameTag);
    } catch {
      continue;
    }
  }
  return `${combatSnapshotItemCount(snapshot)}:${hash}`;
}

function resolveCombatDropSnapshot(player: Player, playerId: string): CombatLootSnapshot | undefined {
  const cached = combatSnapshotsByPlayerId.get(playerId);
  if (cached) {
    if (combatSnapshotItemCount(cached) === 0) return undefined;
    return cloneCombatLoot(cached);
  }
  const liveSnapshot = captureCombatLoot(player);
  if (combatSnapshotItemCount(liveSnapshot) === 0) return undefined;
  return liveSnapshot;
}

function clearInventoryAndEquipment(player: Player): void {
  try {
    const container = getInventoryContainer(player);
    if (container) {
      for (let slot = 0; slot < container.size; slot++) {
        try {
          container.setItem(slot, undefined);
        } catch {
          continue;
        }
      }
    }
  } catch {
  }

  try {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (!equippable) return;
    for (const slotType of EQUIPMENT_SLOTS) {
      try {
        equippable.setEquipment(slotType, undefined);
      } catch {
        continue;
      }
    }
  } catch {
  }
}

function spawnDroppedItems(dimensionId: string, location: { x: number; y: number; z: number }, dropped: ItemStack[]): ItemStack[] {
  if (dropped.length === 0) return [];
  const failed: ItemStack[] = [];
  try {
    const dimension = world.getDimension(dimensionId);
    for (const stack of dropped) {
      try {
        dimension.spawnItem(stack, location);
      } catch {
        failed.push(stack.clone());
      }
    }
  } catch {
    return dropped.map((stack) => stack.clone());
  }
  return failed;
}

export function dropCombatInventory(player: Player, dropLocation: { x: number; y: number; z: number } = player.location): boolean {
  if (!isCombatSystemEnabled()) return false;
  const playerId = getPlayerId(player);
  if (!hasActiveTag(playerId)) return false;

  const snapshot = resolveCombatDropSnapshot(player, playerId);
  if (!snapshot) {
    combatTagsByPlayerId.delete(playerId);
    combatSnapshotsByPlayerId.delete(playerId);
    lastCombatSnapshotAtByPlayerId.delete(playerId);
    return false;
  }

  const entry: PendingCombatLogout = {
    playerId,
    playerName: player.name,
    dimensionId: player.dimension.id,
    location: dropLocation,
    inventory: snapshot.inventory,
    equipment: snapshot.equipment,
    attempts: 0,
  };
  journalAppend("combat", { op: "logout-snapshot", playerId, inventory: snapshot.inventory.length, equipment: snapshot.equipment.length });
  entry.journalSeq = journalHead("combat");
  persistCombatLogout(entry);
  clearInventoryAndEquipment(player);
  const failedEquipment = spawnDroppedItems(player.dimension.id, dropLocation, snapshot.equipment);
  const failedInventory = spawnDroppedItems(player.dimension.id, dropLocation, snapshot.inventory);
  const failed = [...failedEquipment, ...failedInventory];
  if (failed.length > 0) {
    const retry: PendingCombatLogout = {
      playerId,
      playerName: player.name,
      dimensionId: player.dimension.id,
      location: dropLocation,
      inventory: failedInventory,
      equipment: failedEquipment,
      attempts: 0,
      journalSeq: entry.journalSeq,
    };
    pendingCombatLogouts.push(retry);
    persistCombatLogout(retry);
  } else {
    clearPersistedCombatLogout(playerId);
    journalAck("combat", entry.journalSeq ?? journalHead("combat"));
  }
  combatTagsByPlayerId.delete(playerId);
  combatSnapshotsByPlayerId.delete(playerId);
  lastCombatSnapshotAtByPlayerId.delete(playerId);
  return true;
}

function processPendingCombatLogouts(): void {
  restorePersistedCombatLogouts();
  if (pendingCombatLogouts.length === 0) return;
  if (pendingCombatLogoutsJobId !== undefined) return;
  pendingCombatLogoutsJobId = system.runJob(processPendingCombatLogoutsJob());
}

function* processPendingCombatLogoutsJob(): Generator<void, void, void> {
  if (!isCombatSystemEnabled()) {
    pendingCombatLogouts.length = 0;
    pendingCombatLogoutsJobId = undefined;
    return;
  }
  const pending = pendingCombatLogouts.splice(0, pendingCombatLogouts.length);
  for (const logout of pending) {
    if (!isCombatSystemEnabled()) {
      pendingCombatLogouts.length = 0;
      break;
    }
    const failedEquipment = spawnDroppedItems(logout.dimensionId, logout.location, logout.equipment);
    const failedInventory = spawnDroppedItems(logout.dimensionId, logout.location, logout.inventory);
    const failed = [...failedEquipment, ...failedInventory];

    if (failed.length > 0 && logout.attempts < 20) {
      const retry = { ...logout, inventory: failedInventory, equipment: failedEquipment, attempts: logout.attempts + 1 };
      pendingCombatLogouts.push(retry);
      persistCombatLogout(retry);
      continue;
    }

    if (failed.length === 0) {
      clearPersistedCombatLogout(logout.playerId);
      journalAck("combat", logout.journalSeq ?? journalHead("combat"));
      // Marker meaning: "combat-log loot was already dropped at logout location".
      // It is a one-time rejoin notification only; do NOT clear inventory/equipment
      // when reading it in handleCombatJoin() - the items were dropped on disconnect,
      // and any current items belong to the player.
      world.setDynamicProperty(
        penaltyKey(logout.playerId),
        JSON.stringify({ droppedAt: nowMs() })
      );
      if (state.combat.config.announceLogouts) {
        world.sendMessage(formatCombatMessage(state.combat.config.logoutBroadcastMessage, logout.playerName));
      }
    }
    yield;
  }
  pendingCombatLogoutsJobId = undefined;
}

export function handleCombatJoin(player: Player): void {
  const playerId = getPlayerId(player);
  const key = penaltyKey(playerId);
  const penaltyRaw = world.getDynamicProperty(key) as string | undefined;
  if (!penaltyRaw) return;
  // Penalty marker was already settled at logout: items were dropped then.
  // Clear the marker, drop any cached snapshot, and notify the player once.
  // Do not touch the player's current inventory - it belongs to them on rejoin.
  world.setDynamicProperty(key, undefined);
  combatSnapshotsByPlayerId.delete(playerId);
  lastCombatSnapshotAtByPlayerId.delete(playerId);
  tell(player, state.combat.config.rejoinPenaltyMessage);
}

export function handleCombatLeave(player: Player): void {
  const playerId = getPlayerId(player);
  if (!isCombatSystemEnabled()) {
    combatTagsByPlayerId.delete(playerId);
    combatSnapshotsByPlayerId.delete(playerId);
    lastCombatSnapshotAtByPlayerId.delete(playerId);
    return;
  }

  if (!hasActiveTag(playerId)) return;

  const snapshot = resolveCombatDropSnapshot(player, playerId);

  if (!snapshot) {
    combatTagsByPlayerId.delete(playerId);
    combatSnapshotsByPlayerId.delete(playerId);
    lastCombatSnapshotAtByPlayerId.delete(playerId);
    return;
  }

  const location = {
    x: player.location.x,
    y: player.location.y,
    z: player.location.z,
  };
  const dimensionId = player.dimension.id;
  const entry: PendingCombatLogout = {
    playerId,
    playerName: player.name,
    dimensionId,
    location,
    inventory: snapshot.inventory,
    equipment: snapshot.equipment,
    attempts: 0,
  };
  journalAppend("combat", { op: "logout-snapshot", playerId, inventory: snapshot.inventory.length, equipment: snapshot.equipment.length });
  entry.journalSeq = journalHead("combat");
  persistCombatLogout(entry);
  clearInventoryAndEquipment(player);
  pendingCombatLogouts.push(entry);

  combatTagsByPlayerId.delete(playerId);
  combatSnapshotsByPlayerId.delete(playerId);
  lastCombatSnapshotAtByPlayerId.delete(playerId);
  system.run(() => {
    processPendingCombatLogouts();
  });
}

export function handleCombatDeath(player: Player): void {
  const id = getPlayerId(player);
  combatTagsByPlayerId.delete(id);
  combatSnapshotsByPlayerId.delete(id);
  lastCombatSnapshotAtByPlayerId.delete(id);
  invalidatePlayerSidebarCache(player);
}

export function resolveCombatAttacker(damageSource: EntityDamageSource): Player | undefined {
  const direct = asPlayer(damageSource.damagingEntity);
  if (direct) return direct;

  const projectile = damageSource.damagingProjectile;
  if (!projectile) return undefined;

  try {
    const projectileComp = projectile.getComponent(EntityComponentTypes.Projectile) as { owner?: Entity } | undefined;
    return asPlayer(projectileComp?.owner);
  } catch {
    return undefined;
  }
}

export function resolveCombatProjectileAttacker(projectile: Entity, source?: Entity): Player | undefined {
  const directSource = asPlayer(source);
  if (directSource) return directSource;

  try {
    const projectileComp = projectile.getComponent(EntityComponentTypes.Projectile) as { owner?: Entity } | undefined;
    return asPlayer(projectileComp?.owner);
  } catch {
    return undefined;
  }
}

export function handleCombatDamage(victim: Player, attacker: Player): void {
  if (!isCombatSystemEnabled()) return;
  if (victim.id === attacker.id) return;
  setCombatTag(victim);
  setCombatTag(attacker);
}

function rankMatches(player: Player, ranks: string[]): boolean {
  if (ranks.length === 0) return false;
  const rank = getPlayerRank(player.name);
  return Boolean(rank && ranks.includes(rank.id));
}

function matchesKillCondition(rule: KillConditionRule, killer: Player, victim: Player, context: CombatKillContext): boolean {
  const filters = rule.filters;
  if (filters.requireKillerRankMatch && !rankMatches(killer, filters.killerRanks ?? [])) return false;
  if (filters.requireVictimRankMatch && !rankMatches(victim, filters.victimRanks ?? [])) return false;
  if (filters.minKillerKillstreak !== undefined && context.killstreak < filters.minKillerKillstreak) return false;
  if (filters.maxKillerKillstreak !== undefined && context.killstreak > filters.maxKillerKillstreak) return false;
  if (filters.minKillerKills !== undefined && context.killerStats.kills < filters.minKillerKills) return false;
  return true;
}

function replaceKillPlaceholders(value: string, killer: Player, victim: Player, context: CombatKillContext): string {
  const killerRank = getPlayerRank(killer.name)?.id ?? "";
  const victimRank = getPlayerRank(victim.name)?.id ?? "";
  const loc = victim.location;
  return renderTemplate(value, {
    player: killer,
    killer,
    victim,
    extra: {
      killer_id: getPlayerId(killer),
      victim_id: getPlayerId(victim),
      killer_rank: killerRank,
      victim_rank: victimRank,
      killstreak: context.killstreak,
      kills: context.killerStats.kills,
      x: Math.floor(loc.x),
      y: Math.floor(loc.y),
      z: Math.floor(loc.z),
      dimension: victim.dimension.id,
    },
  });
}

function ensureObjective(objectiveId: string): boolean {
  const existing = world.scoreboard.getObjective(objectiveId);
  if (existing) return true;
  try {
    world.scoreboard.addObjective(objectiveId, objectiveId);
    return true;
  } catch {
    return false;
  }
}

function runKillConditionAction(action: KillConditionAction, killer: Player, victim: Player, context: CombatKillContext): void {
  if (action.type === "score") {
    const target = action.target === "victim" ? victim : killer;
    if (!ensureObjective(action.objective)) return;
    const current = getScore(target, action.objective) ?? 0;
    const amount = Math.floor(Number(action.amount) || 0);
    const next = action.operation === "set"
      ? amount
      : action.operation === "remove"
        ? current - amount
        : current + amount;
    if (setScore(target, action.objective, next)) return;

    try {
      target.runCommand(`scoreboard players set @s ${action.objective} ${next}`);
    } catch {
      // ignore score initialization failures
    }
    return;
  }

  if (action.type === "command") {
    const commands = action.commands.slice(0, 10);
    system.run(() => {
      for (const raw of commands) {
        const command = renderCommandTemplate(replaceKillPlaceholders(raw, killer, victim, context));
        if (!command) continue;
        if (runBuiltCommandFromConfiguredCommand(killer, command)) continue;
        try {
          killer.runCommand(command);
        } catch {
        }
      }
    });
  }
}

export function handleCombatKill(killer: Player, victim: Player, context: CombatKillContext): void {
  if (!isFeatureEnabled("combat")) return;
  const killConditions = state.combat.config.killConditions;
  if (!killConditions?.enabled) return;
  const rules = killConditions.rules
    .filter((rule) => rule.enabled)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  for (const rule of rules) {
    if (!matchesKillCondition(rule, killer, victim, context)) continue;
    for (const action of rule.actions.slice(0, 20)) {
      runKillConditionAction(action, killer, victim, context);
    }
  }
}

export function shouldBlockCommandWhileTagged(player: Player, message: string): boolean {
  if (!isCombatSystemEnabled()) return false;
  if (!state.combat.config.blockCommands) return false;

  const text = String(message ?? "").trim();
  if (!text.startsWith("/")) return false;

  const playerId = getPlayerId(player);
  if (!isTagged(player, playerId)) return false;

  tell(player, state.combat.config.blockedCommandMessage);
  return true;
}

export function processCombatTags(cachedPlayers?: Player[]): void {
  if (!isCombatSystemEnabled()) {
    if (combatTagsJobId !== undefined) {
      system.clearJob(combatTagsJobId);
      combatTagsJobId = undefined;
    }
    combatTagsByPlayerId.clear();
    combatSnapshotsByPlayerId.clear();
    lastCombatSnapshotAtByPlayerId.clear();
    pendingCombatLogouts.length = 0;
    return;
  }

  processPendingCombatLogouts();
  if (combatTagsByPlayerId.size === 0) return;
  if (combatTagsJobId !== undefined) return;
  combatTagsJobId = system.runJob(processCombatTagsJob(cachedPlayers));
}

function* processCombatTagsJob(cachedPlayers?: Player[]): Generator<void, void, void> {
  if (!isCombatSystemEnabled()) {
    combatTagsJobId = undefined;
    return;
  }
  const now = nowMs();
  const onlineById = new Map<string, Player>();
  for (const player of cachedPlayers ?? world.getAllPlayers()) {
    onlineById.set(getPlayerId(player), player);
  }

  for (const [playerId, entry] of combatTagsByPlayerId.entries()) {
    if (!isCombatSystemEnabled()) break;
    if (entry.expiresAt <= now) continue;
    if (now - (lastCombatSnapshotAtByPlayerId.get(playerId) ?? 0) < COMBAT_SNAPSHOT_INTERVAL_MS) continue;
    const player = onlineById.get(playerId);
    if (player) {
      const cached = combatSnapshotsByPlayerId.get(playerId);
      if (cached && combatSnapshotItemCount(cached) > 0) {
        const live = scanCombatLootFingerprint(player);
        if (live.count > 0 && live.hash === combatSnapshotContentHash(cached)) {
          lastCombatSnapshotAtByPlayerId.set(playerId, now);
        } else {
          combatSnapshotsByPlayerId.set(playerId, captureCombatLoot(player));
          lastCombatSnapshotAtByPlayerId.set(playerId, now);
        }
      } else {
        combatSnapshotsByPlayerId.set(playerId, captureCombatLoot(player));
        lastCombatSnapshotAtByPlayerId.set(playerId, now);
      }
    }
    yield;
  }

  for (const [playerId, entry] of combatTagsByPlayerId.entries()) {
    if (!isCombatSystemEnabled()) break;
    if (entry.expiresAt > now) continue;
    const player = onlineById.get(playerId);
    if (player) clearCombatTag(player, playerId, true);
    else {
      combatTagsByPlayerId.delete(playerId);
      combatSnapshotsByPlayerId.delete(playerId);
      lastCombatSnapshotAtByPlayerId.delete(playerId);
    }
    yield;
  }
  combatTagsJobId = undefined;
}

// ---------------------------------------------------------------------------
// Commit services: domain write path for admin UI mutations.
// ---------------------------------------------------------------------------

export function getKillConditionRule(ruleId: string): KillConditionRule | undefined {
  return state.combat.config.killConditions.rules.find((rule) => rule.id === ruleId);
}

export function commitKillConditionRule(rule: KillConditionRule): { ok: boolean; message: string } {
  if (!rule.id) return { ok: false, message: "Kill rule ID is missing." };
  const rules = state.combat.config.killConditions.rules;
  const index = rules.findIndex((entry) => entry.id === rule.id);
  const next: KillConditionRule = {
    ...rule,
    filters: { ...rule.filters, killerRanks: [...rule.filters.killerRanks], victimRanks: [...rule.filters.victimRanks] },
    actions: rule.actions.map((action) => ({ ...action })),
  };
  if (index >= 0) rules[index] = next;
  else rules.push(next);
  saveCombat();
  return { ok: true, message: `Saved kill rule ${next.name}.` };
}

export function createKillConditionRule(): { ok: boolean; message: string; rule?: KillConditionRule } {
  const rule: KillConditionRule = {
    id: `kill_${Date.now().toString(36)}`,
    name: "New Kill Rule",
    enabled: true,
    priority: 0,
    filters: {
      requireKillerRankMatch: false,
      killerRanks: [],
      requireVictimRankMatch: false,
      victimRanks: [],
    },
    actions: [],
  };
  const saved = commitKillConditionRule(rule);
  if (!saved.ok) return saved;
  return { ok: true, message: `Created kill rule ${rule.name}.`, rule: getKillConditionRule(rule.id) };
}

export function duplicateKillConditionRule(ruleId: string): { ok: boolean; message: string; rule?: KillConditionRule } {
  const source = getKillConditionRule(ruleId);
  if (!source) return { ok: false, message: "Kill rule not found." };
  const copy: KillConditionRule = {
    ...source,
    id: `kill_${Date.now().toString(36)}`,
    name: `${source.name} Copy`,
    filters: { ...source.filters, killerRanks: [...source.filters.killerRanks], victimRanks: [...source.filters.victimRanks] },
    actions: source.actions.map((action) => ({ ...action })),
  };
  const saved = commitKillConditionRule(copy);
  if (!saved.ok) return saved;
  return { ok: true, message: "Kill rule duplicated.", rule: getKillConditionRule(copy.id) };
}

export function deleteKillConditionRule(ruleId: string): { ok: boolean; message: string } {
  const rules = state.combat.config.killConditions.rules;
  if (!rules.some((entry) => entry.id === ruleId)) return { ok: false, message: "Kill rule not found." };
  state.combat.config.killConditions.rules = rules.filter((entry) => entry.id !== ruleId);
  saveCombat();
  return { ok: true, message: "Kill rule deleted." };
}

export function commitKillConditionActions(ruleId: string, actions: KillConditionAction[]): { ok: boolean; message: string } {
  const rule = getKillConditionRule(ruleId);
  if (!rule) return { ok: false, message: "Kill rule not found." };
  return commitKillConditionRule({ ...rule, actions: actions.map((action) => ({ ...action })) });
}

export function setKillConditionsEnabled(enabled: boolean): { ok: boolean; message: string } {
  state.combat.config.killConditions.enabled = enabled;
  saveCombat();
  return { ok: true, message: `Kill conditions ${enabled ? "enabled" : "disabled"}.` };
}

export function updateCombatConfig(partial: Partial<Omit<CombatConfig, "killConditions">>): { ok: boolean; message: string } {
  const config = state.combat.config;
  if (partial.enabled !== undefined) config.enabled = partial.enabled;
  if (partial.combatTimeSeconds !== undefined) config.combatTimeSeconds = Math.max(1, Math.floor(partial.combatTimeSeconds));
  if (partial.announceLogouts !== undefined) config.announceLogouts = partial.announceLogouts;
  if (partial.blockCommands !== undefined) config.blockCommands = partial.blockCommands;
  if (partial.enterMessage !== undefined) config.enterMessage = partial.enterMessage;
  if (partial.exitMessage !== undefined) config.exitMessage = partial.exitMessage;
  if (partial.logoutBroadcastMessage !== undefined) config.logoutBroadcastMessage = partial.logoutBroadcastMessage;
  if (partial.rejoinPenaltyMessage !== undefined) config.rejoinPenaltyMessage = partial.rejoinPenaltyMessage;
  if (partial.blockedCommandMessage !== undefined) config.blockedCommandMessage = partial.blockedCommandMessage;
  saveCombat();
  return { ok: true, message: "Combat settings saved." };
}
