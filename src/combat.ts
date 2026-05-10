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
import { asPlayer, getInventoryContainer, getPlayerId, getPlayerRank, getScore, isFeatureEnabled, setScore, state, tell } from "./storage";
import type { KillConditionAction, KillConditionRule, PlayerStats } from "./types";

type CombatTagEntry = {
  expiresAt: number;
};

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
};

type CombatKillContext = {
  killerStats: PlayerStats;
  killstreak: number;
};

const combatTagsByPlayerId = new Map<string, CombatTagEntry>();
const combatSnapshotsByPlayerId = new Map<string, CombatLootSnapshot>();
const pendingCombatLogouts: PendingCombatLogout[] = [];
const PENALTY_KEY_PREFIX = "tau:combat:penalty:";
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

function formatCombatMessage(template: string, playerName: string): string {
  return String(template ?? "").split("{player}").join(playerName);
}

function commandStripSlash(value: string): string {
  return String(value ?? "").trim().replace(/^\/+/, "");
}

function getCombatDurationMs(): number {
  const seconds = Math.max(1, Math.floor(Number(state.combat.config.combatTimeSeconds ?? 15)));
  return seconds * 1000;
}

function isCombatSystemEnabled(): boolean {
  return isFeatureEnabled("combat") && state.combat.config.enabled;
}

function clearCombatTag(player: Player, playerId: string, notify: boolean): void {
  combatTagsByPlayerId.delete(playerId);
  combatSnapshotsByPlayerId.delete(playerId);
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
  const entry = combatTagsByPlayerId.get(playerId);
  if (!entry) return false;
  if (entry.expiresAt > nowMs()) return true;
  combatTagsByPlayerId.delete(playerId);
  combatSnapshotsByPlayerId.delete(playerId);
  return false;
}

function setCombatTag(player: Player): void {
  const id = getPlayerId(player);
  const tagged = isTagged(player, id);
  combatTagsByPlayerId.set(id, { expiresAt: nowMs() + getCombatDurationMs() });
  combatSnapshotsByPlayerId.set(id, captureCombatLoot(player));
  if (!tagged) tell(player, state.combat.config.enterMessage);
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

function processPendingCombatLogouts(): void {
  if (pendingCombatLogouts.length === 0) return;
  const pending = pendingCombatLogouts.splice(0, pendingCombatLogouts.length);
  for (const logout of pending) {
    const failedEquipment = spawnDroppedItems(logout.dimensionId, logout.location, logout.equipment);
    const failedInventory = spawnDroppedItems(logout.dimensionId, logout.location, logout.inventory);
    const failed = [...failedEquipment, ...failedInventory];

    if (failed.length > 0 && logout.attempts < 20) {
      pendingCombatLogouts.push({ ...logout, inventory: failedInventory, equipment: failedEquipment, attempts: logout.attempts + 1 });
      continue;
    }

    if (failed.length === 0) {
      world.setDynamicProperty(
        penaltyKey(logout.playerId),
        JSON.stringify({ droppedAt: nowMs() })
      );
      if (state.combat.config.announceLogouts) {
        world.sendMessage(formatCombatMessage(state.combat.config.logoutBroadcastMessage, logout.playerName));
      }
    }
  }
}

export function handleCombatJoin(player: Player): void {
  const playerId = getPlayerId(player);
  const key = penaltyKey(playerId);
  const penaltyRaw = world.getDynamicProperty(key) as string | undefined;
  if (!penaltyRaw) return;
  world.setDynamicProperty(key, undefined);
  combatSnapshotsByPlayerId.delete(playerId);
  clearInventoryAndEquipment(player);
  tell(player, state.combat.config.rejoinPenaltyMessage);
}

export function handleCombatLeave(player: Player): void {
  const playerId = getPlayerId(player);
  if (!isCombatSystemEnabled()) {
    combatTagsByPlayerId.delete(playerId);
    return;
  }

  if (!hasActiveTag(playerId)) return;

  const liveSnapshot = captureCombatLoot(player);
  const cachedSnapshot = combatSnapshotsByPlayerId.get(playerId);
  const liveCount = liveSnapshot.inventory.length + liveSnapshot.equipment.length;
  const snapshot = liveCount > 0
    ? liveSnapshot
    : (cachedSnapshot ? cloneCombatLoot(cachedSnapshot) : { inventory: [], equipment: [] });

  clearInventoryAndEquipment(player);

  const location = {
    x: player.location.x,
    y: player.location.y,
    z: player.location.z,
  };
  const dimensionId = player.dimension.id;
  pendingCombatLogouts.push({
    playerId,
    playerName: player.name,
    dimensionId,
    location,
    inventory: snapshot.inventory,
    equipment: snapshot.equipment,
    attempts: 0,
  });

  combatTagsByPlayerId.delete(playerId);
  combatSnapshotsByPlayerId.delete(playerId);
  system.run(() => {
    processPendingCombatLogouts();
  });
}

export function handleCombatDeath(player: Player): void {
  const id = getPlayerId(player);
  combatTagsByPlayerId.delete(id);
  combatSnapshotsByPlayerId.delete(id);
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
  return String(value ?? "")
    .split("{killer}").join(killer.name)
    .split("{victim}").join(victim.name)
    .split("{killer_id}").join(getPlayerId(killer))
    .split("{victim_id}").join(getPlayerId(victim))
    .split("{killer_rank}").join(killerRank)
    .split("{victim_rank}").join(victimRank)
    .split("{killstreak}").join(String(context.killstreak))
    .split("{kills}").join(String(context.killerStats.kills))
    .split("{x}").join(String(Math.floor(loc.x)))
    .split("{y}").join(String(Math.floor(loc.y)))
    .split("{z}").join(String(Math.floor(loc.z)))
    .split("{dimension}").join(victim.dimension.id);
}

function runKillConditionAction(action: KillConditionAction, killer: Player, victim: Player, context: CombatKillContext): void {
  if (action.type === "score") {
    const target = action.target === "victim" ? victim : killer;
    const current = getScore(target, action.objective);
    if (current === undefined) return;
    const amount = Math.floor(Number(action.amount) || 0);
    const next = action.operation === "set"
      ? amount
      : action.operation === "remove"
        ? current - amount
        : current + amount;
    setScore(target, action.objective, next);
    return;
  }

  if (action.type === "command") {
    const commands = action.commands.slice(0, 10);
    system.run(() => {
      for (const raw of commands) {
        const command = commandStripSlash(replaceKillPlaceholders(raw, killer, victim, context));
        if (!command) continue;
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

export function processCombatTags(): void {
  if (!isCombatSystemEnabled()) {
    combatTagsByPlayerId.clear();
    combatSnapshotsByPlayerId.clear();
    pendingCombatLogouts.length = 0;
    return;
  }

  processPendingCombatLogouts();

  const onlineById = new Map<string, Player>();
  for (const player of world.getAllPlayers()) {
    onlineById.set(getPlayerId(player), player);
  }

  for (const [playerId, entry] of combatTagsByPlayerId.entries()) {
    if (entry.expiresAt <= nowMs()) continue;
    const player = onlineById.get(playerId);
    if (player) combatSnapshotsByPlayerId.set(playerId, captureCombatLoot(player));
  }

  const now = nowMs();
  for (const [playerId, entry] of combatTagsByPlayerId.entries()) {
    if (entry.expiresAt > now) continue;
    const player = onlineById.get(playerId);
    if (player) clearCombatTag(player, playerId, true);
    else combatTagsByPlayerId.delete(playerId);
  }
}
