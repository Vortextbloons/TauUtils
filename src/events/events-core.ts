import { ItemStack, Player, world, system } from "@minecraft/server";
import { ensurePlayerPlotAssigned, getAssignedSlotIdForOwner, getPlotForLocation, getPlotOwnerIdForPlayer, getPlotSlotsList, getPlotTitle, processQueuedPlotBuildJobs, processQueuedPlotSnapshots, reconcileAllPlotState, releasePlayerPlotById, saveAssignedPlayerPlot, showPlotError, teleportPlayerToSlot } from "../plots";
import { describeGeneratorStack, getPlacedGeneratorAtLocation, handleGeneratorUseOnBlock, isGeneratorBlock, processGenerators } from "../generators";
import { tryHandleCrateInteract } from "../crates";
import { tryHandleTauItemTrigger } from "../tau-items";
import { getPlayerTeam } from "../teams";
import { handleCombatDamage, handleCombatDeath, handleCombatJoin, handleCombatLeave, processCombatTags, resolveCombatAttacker, resolveCombatProjectileAttacker, shouldBlockCommandWhileTagged } from "../combat";
import {
  asPlayer,
  incrementStat,
  formatChatMessage,
  getInventoryContainer,
  getPlayerStats,
  getPlayerStatsById,
  getPlayerId,
  getMenuIdFromTags,
  getMenuIdFromNameTag,
  isFeatureEnabled,
  normalizeKey,
  state,
  saveModeration,
  tell,
} from "../storage";

const generatorMenuOpenByPlayerId = new Map<string, number>();
const pendingJoinInitializationByName = new Set<string>();

function openGeneratorMenuOnce(player: ReturnType<typeof asPlayer>, placed: { definitionId: string; x: number; y: number; z: number; dimensionId: string }): void {
  if (!player) return;
  const playerId = getPlayerId(player);
  const now = Date.now();
  const lastOpenAt = generatorMenuOpenByPlayerId.get(playerId) ?? 0;
  if (now - lastOpenAt < 600) return;
  generatorMenuOpenByPlayerId.set(playerId, now);
  system.run(() => {
    void import("../forms-ui").then((formsUi) => {
      void formsUi.showGeneratorUpgradeMenu(player, placed.definitionId, { x: placed.x, y: placed.y, z: placed.z }, placed.dimensionId);
    });
  });
  system.runTimeout(() => {
    generatorMenuOpenByPlayerId.delete(playerId);
  }, 20);
}

function normalizeItemId(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function isBannedItemId(itemId: string): boolean {
  const normalized = normalizeItemId(itemId);
  return state.moderation.bannedItems.some((entry) => normalizeItemId(entry.itemId) === normalized);
}

function getPlayerEnderContainer(player: Player): { size: number; getItem(slot: number): ItemStack | undefined } | undefined {
  try {
    const ender = player.getComponent("minecraft:ender_inventory") as { container?: { size: number; getItem(slot: number): ItemStack | undefined } } | undefined;
    return ender?.container;
  } catch {
    try {
      const ender = player.getComponent("ender_inventory") as { container?: { size: number; getItem(slot: number): ItemStack | undefined } } | undefined;
      return ender?.container;
    } catch {
      return undefined;
    }
  }
}

function snapshotContainer(container: { size: number; getItem(slot: number): ItemStack | undefined }): Array<{ slot: number; itemId: string; amount: number; nameTag?: string; lore?: string[] }> {
  const snapshot: Array<{ slot: number; itemId: string; amount: number; nameTag?: string; lore?: string[] }> = [];
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (!stack) continue;
    snapshot.push({
      slot,
      itemId: stack.typeId,
      amount: stack.amount,
      nameTag: stack.nameTag?.trim() || undefined,
      lore: stack.getLore().map((line) => String(line).trim()).filter((line) => line.length > 0),
    });
  }
  return snapshot;
}

function cacheModerationInspectionSnapshot(player: Player | undefined): void {
  if (!player) return;
  state.moderation.inspectionSnapshots ??= {};
  const key = player.name.toLowerCase();
  const current = state.moderation.inspectionSnapshots[key];
  const inventory = getInventoryContainer(player);
  const ender = getPlayerEnderContainer(player);
  const inventorySnapshot = inventory ? snapshotContainer(inventory) : (current?.inventory ?? []);
  const nextEnderSnapshot = ender ? snapshotContainer(ender) : [];
  const enderSnapshot = nextEnderSnapshot.length > 0 ? nextEnderSnapshot : (current?.enderChest ?? []);
  state.moderation.inspectionSnapshots[key] = {
    playerName: player.name,
    updatedAt: Date.now(),
    inventory: inventorySnapshot,
    enderChest: enderSnapshot,
  };
  saveModeration();
}

function initializePlayerJoinState(player: ReturnType<typeof asPlayer>): void {
  if (!player) return;
  const id = getPlayerId(player);
  lastSampleByPlayerId[id] = { x: player.location.x, y: player.location.y, z: player.location.z };
  clearBannedInventoryItems(player);
  handleCombatJoin(player);

  if (!isFeatureEnabled("plots")) return;

  reconcileAllPlotState("player_join_init");
  const ensured = ensurePlayerPlotAssigned(player);
  if (!ensured.ok) showPlotError(player, ensured.message);

  const ownerId = getPlotOwnerIdForPlayer(player);
  const spawnedInSlot = getPlotForLocation(player.location);
  if (ownerId && spawnedInSlot) {
    const assignedSlotId = getAssignedSlotIdForOwner(ownerId);
    if (assignedSlotId && assignedSlotId !== spawnedInSlot.id) {
      const moved = teleportPlayerToSlot(player, assignedSlotId);
      if (!moved.ok) showPlotError(player, moved.message);
    }
  }
}

export function initializeOnlinePlayersAfterReload(): void {
  for (const player of getCachedPlayers()) {
    initializePlayerJoinState(player);
  }
}

function schedulePlayerJoinInitialization(playerName: string): void {
  schedulePlayerJoinInitializationRetry(playerName, 0);
}

function schedulePlayerJoinInitializationRetry(playerName: string, attempt: number): void {
  if (attempt === 0) {
    if (pendingJoinInitializationByName.has(playerName)) return;
    pendingJoinInitializationByName.add(playerName);
  }
  system.runTimeout(() => {
    const player = getCachedPlayers().find((entry) => entry.name === playerName);
    if (player) {
      pendingJoinInitializationByName.delete(playerName);
      initializePlayerJoinState(player);
      return;
    }
    if (attempt >= 10) {
      pendingJoinInitializationByName.delete(playerName);
      return;
    }
    schedulePlayerJoinInitializationRetry(playerName, attempt + 1);
  }, 1);
}

function clearBannedHeldItem(player: ReturnType<typeof asPlayer>): void {
  if (!player) return;
  const container = getInventoryContainer(player);
  if (!container) return;
  const held = container.getItem(player.selectedSlotIndex);
  if (!held) return;
  if (!isBannedItemId(held.typeId)) return;
  container.setItem(player.selectedSlotIndex, undefined);
}

function clearBannedInventoryItems(player: ReturnType<typeof asPlayer>): number {
  if (!player) return 0;
  const container = getInventoryContainer(player);
  if (!container) return 0;
  let removed = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (!stack || !isBannedItemId(stack.typeId)) continue;
    removed += stack.amount;
    container.setItem(slot, undefined);
  }
  return removed;
}

type DistanceSample = {
  x: number;
  y: number;
  z: number;
};

const lastSampleByPlayerId: Record<string, DistanceSample> = {};
const lastSeenPlotByPlayerId: Record<string, string | undefined> = {};

let cachedPlayersTick = -1;
let cachedPlayers: Player[] = [];

function getCachedPlayers(): Player[] {
  if (cachedPlayersTick !== system.currentTick) {
    cachedPlayers = world.getAllPlayers();
    cachedPlayersTick = system.currentTick;
  }
  return cachedPlayers;
}

function resolveItemMenu(itemStack: ItemStack): string | undefined {
  const lore = itemStack.getLore();
  for (const line of lore) {
    const menuId = state.binds.itemBinds[`lore:${line.trim()}`];
    if (menuId) return menuId;
    const menuIdNorm = state.binds.itemBinds[`lore:${normalizeKey(line)}`];
    if (menuIdNorm) return menuIdNorm;
  }
  const tagged = getMenuIdFromTags(itemStack.getTags());
  if (tagged) return tagged;
  return (
    state.binds.itemBinds[itemStack.typeId] ??
    state.binds.itemBinds[normalizeKey(itemStack.typeId)]
  );
}

function resolveEntityMenu(entity: { getTags(): string[]; nameTag?: string; hasTag(tag: string): boolean }): string | undefined {
  const fromTag = getMenuIdFromTags(entity.getTags());
  if (fromTag) return fromTag;

  const fromNameTag = getMenuIdFromNameTag(entity.nameTag);
  if (fromNameTag) return fromNameTag;

  for (const [tag, menuId] of Object.entries(state.binds.entityTagBinds)) {
    if (entity.hasTag(tag)) return menuId;
  }

  return undefined;
}

export function registerEventInterceptors() {
  world.afterEvents.playerJoin.subscribe((event) => {
    const player = getCachedPlayers().find((entry) => entry.name === event.playerName);
    if (!player) {
      schedulePlayerJoinInitialization(event.playerName);
      return;
    }
    schedulePlayerJoinInitialization(player.name);
  });

  world.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn) return;
    schedulePlayerJoinInitialization(event.player.name);
  });

  world.beforeEvents.playerLeave.subscribe((event) => {
    handleCombatLeave(event.player);
  });

  world.afterEvents.playerLeave.subscribe((event) => {
    if (!isFeatureEnabled("plots")) return;
    const playerId = state.stats.playerIds[event.playerName];
    if (playerId) {
      const team = Object.values(state.teams.teams).find((entry) => entry.ownerPlayerId === playerId || entry.memberPlayerIds.includes(playerId));
      if (team && team.teamPlotEnabled) {
        const anyMemberOnline = world.getAllPlayers().some((online) => team.memberPlayerIds.includes(getPlayerId(online)));
        if (anyMemberOnline) return;
        releasePlayerPlotById(team.ownerPlayerId);
        return;
      }
    }
    if (playerId) releasePlayerPlotById(playerId);
    reconcileAllPlotState("player_leave");
  });

  world.beforeEvents.chatSend.subscribe((event) => {
    if (shouldBlockCommandWhileTagged(event.sender, event.message)) {
      event.cancel = true;
      return;
    }
    if (!isFeatureEnabled("ranks")) return;
    const formatted = formatChatMessage(event.sender, event.message);
    event.cancel = true;
    system.run(() => {
      world.sendMessage(formatted);
    });
  });

  world.afterEvents.itemUse.subscribe((event) => {
    const player = asPlayer(event.source);
    if (player) clearBannedInventoryItems(player);

    if (player && isFeatureEnabled("items")) {
      const handled = tryHandleTauItemTrigger(player, "use_air", event.itemStack, {
        location: player.location,
      });
      if (handled.matched && handled.message) tell(player, handled.message);
    }

    if (!isFeatureEnabled("forms")) return;
    const menuId = resolveItemMenu(event.itemStack);
    if (!menuId) return;
    system.run(async () => {
      const { openFormById } = await import("../forms-ui");
      openFormById(event.source, menuId);
    });
  });

  world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    if (!isFeatureEnabled("forms")) return;
    const menuId = resolveEntityMenu(event.target);
    if (!menuId) return;
    system.run(async () => {
      const { openFormById } = await import("../forms-ui");
      openFormById(event.player, menuId);
    });
  });

  system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "tau") return;
    const player = asPlayer(event.sourceEntity) ?? asPlayer(event.initiator);
    if (!player) return;
    const [subcommand, ...rest] = event.message.trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    if (subcommand === "open") {
      if (!isFeatureEnabled("forms")) {
        tell(player, "Forms are disabled.");
        return;
      }
      if (!arg) {
        tell(player, "Usage: /scriptevent tau open <menu_id>");
        return;
      }
      system.run(async () => {
        const { openFormById } = await import("../forms-ui");
        openFormById(player, arg);
      });
    } else if (subcommand === "creator") {
      if (!isFeatureEnabled("creator")) {
        tell(player, "Creator is disabled.");
        return;
      }
      system.run(async () => {
        const { showCreatorMenu } = await import("../forms-ui");
        showCreatorMenu(player);
      });
    }
  });

  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (!isFeatureEnabled("stats")) return;
    incrementStat(event.player, "blocksPlaced", 1);
  });

  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (event.block.typeId === "minecraft:ender_chest" || event.block.typeId === "ender_chest") {
      system.runTimeout(() => cacheModerationInspectionSnapshot(event.player), 1);
    }

    if (isFeatureEnabled("items")) {
      const handled = tryHandleTauItemTrigger(event.player, "use_block", event.itemStack, {
        location: event.block.location,
      });
      if (handled.matched) {
        if (handled.cancel) event.cancel = true;
        if (handled.message) tell(event.player, handled.message);
        if (handled.cancel) return;
      }
    }

    if (isFeatureEnabled("crates")) {
      const crate = tryHandleCrateInteract(event.player, event.block, event.itemStack);
      if (crate.handled) {
        event.cancel = true;
        if (crate.message) tell(event.player, crate.message);
        return;
      }
    }

    if (isFeatureEnabled("generators")) {
      const heldStack = getInventoryContainer(event.player)?.getItem(event.player.selectedSlotIndex);
      const hasGeneratorItem = Boolean(describeGeneratorStack(heldStack ?? event.itemStack));
      if (event.player.isSneaking && !hasGeneratorItem && isGeneratorBlock(event.block.location, event.player.dimension.id)) {
        event.cancel = true;
        const placed = getPlacedGeneratorAtLocation(event.block.location, event.player.dimension.id);
        if (placed) openGeneratorMenuOnce(event.player, placed);
        return;
      }
    }

    if (!isFeatureEnabled("generators")) return;
    const heldStack = getInventoryContainer(event.player)?.getItem(event.player.selectedSlotIndex);
    if (!describeGeneratorStack(heldStack)) return;
    event.cancel = true;
    system.run(() => {
      const currentHeld = getInventoryContainer(event.player)?.getItem(event.player.selectedSlotIndex);
      const placed = handleGeneratorUseOnBlock(event.player, event.block.location, event.player.dimension.id, currentHeld, event.blockFace);
      if (!placed.message) return;
      tell(event.player, placed.ok ? `§a[Generators] ${placed.message}` : `§c[Generators] ${placed.message}`);
    });
  });

  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (isFeatureEnabled("items")) {
      const held = getInventoryContainer(event.player)?.getItem(event.player.selectedSlotIndex);
      const handled = tryHandleTauItemTrigger(event.player, "mine_block", held, {
        location: event.block.location,
      });
      if (handled.matched) {
        if (handled.cancel) event.cancel = true;
        if (handled.message) tell(event.player, handled.message);
        if (handled.cancel) return;
      }
    }

    if (!isFeatureEnabled("stats")) return;
    incrementStat(event.player, "blocksBroken", 1);
  });

  world.afterEvents.entityDie.subscribe((event) => {
    const dead = asPlayer(event.deadEntity);
    if (dead) {
      handleCombatDeath(dead);
      if (!isFeatureEnabled("stats")) return;
      saveAssignedPlayerPlot(dead);
      incrementStat(dead, "deaths", 1);
      const deadStats = getPlayerStats(dead);
      deadStats.killstreak = 0;
      if (deadStats.longestKillstreak < deadStats.killstreak) deadStats.longestKillstreak = deadStats.killstreak;
      void getPlayerStatsById(getPlayerId(dead));
      return;
    }

    if (!isFeatureEnabled("stats")) return;
    const killer = asPlayer(event.damageSource.damagingEntity);
    if (killer) {
      incrementStat(killer, "kills", 1);
      const streak = incrementStat(killer, "killstreak", 1);
      const killerStats = getPlayerStats(killer);
      if (streak > killerStats.longestKillstreak) killerStats.longestKillstreak = streak;
    }
  });

  world.beforeEvents.entityHurt.subscribe((event) => {
    const victim = asPlayer(event.hurtEntity);
    const attacker = asPlayer(event.damageSource.damagingEntity);
    if (!victim || !attacker) return;
    if (!isFeatureEnabled("teams")) return;

    const victimTeam = getPlayerTeam(victim);
    if (!victimTeam) return;
    if (victimTeam.ownerPlayerId !== getPlayerId(attacker) && !victimTeam.memberPlayerIds.includes(getPlayerId(attacker))) return;
    if (victimTeam.friendlyFire) return;

    event.cancel = true;
  });

  world.afterEvents.entityHurt.subscribe((event) => {
    const victim = asPlayer(event.hurtEntity);
    if (!victim) return;
    const attacker = resolveCombatAttacker(event.damageSource);
    if (!attacker) return;
    handleCombatDamage(victim, attacker);
  });

  world.afterEvents.projectileHitEntity.subscribe((event) => {
    const victim = asPlayer(event.getEntityHit().entity);
    if (!victim) return;
    const attacker = resolveCombatProjectileAttacker(event.projectile, event.source);
    if (!attacker) return;
    handleCombatDamage(victim, attacker);
  });

  world.afterEvents.entityHitEntity.subscribe((event) => {
    if (!isFeatureEnabled("items")) return;
    const player = asPlayer(event.damagingEntity);
    if (!player) return;
    const held = getInventoryContainer(player)?.getItem(player.selectedSlotIndex);
    const handled = tryHandleTauItemTrigger(player, "hit_melee", held, {
      targetEntity: event.hitEntity,
      location: event.hitEntity.location,
    });
    if (handled.matched && handled.message) tell(player, handled.message);
  });

  system.runInterval(() => {
    processCombatTags();
  }, 20);

  system.runInterval(() => {
    if (!isFeatureEnabled("stats")) return;
    for (const player of getCachedPlayers()) {
      const id = getPlayerId(player);
      const prev = lastSampleByPlayerId[id];
      if (prev) {
        const dx = player.location.x - prev.x;
        const dy = player.location.y - prev.y;
        const dz = player.location.z - prev.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 0) incrementStat(player, "distanceTraveled", dist);
      }
      lastSampleByPlayerId[id] = { x: player.location.x, y: player.location.y, z: player.location.z };
      incrementStat(player, "timePlayed", 1);
    }
  }, 20);

  let plotSaveCursor = 0;
  system.runInterval(() => {
    if (!isFeatureEnabled("plots")) return;
    processQueuedPlotSnapshots();
    const players = getCachedPlayers();
    if (players.length === 0) return;
    const perTick = Math.max(1, Math.ceil(players.length / 10));
    for (let i = 0; i < perTick; i++) {
      const player = players[plotSaveCursor % players.length];
      if (player) saveAssignedPlayerPlot(player);
      plotSaveCursor++;
    }
  }, Math.max(1, state.plots.config.saveIntervalTicks));

  system.runInterval(() => {
    if (!isFeatureEnabled("plots")) return;
    if (!state.plots.config.autoBuild.showEnterTitle) return;

    const radius = Math.max(1, state.plots.config.autoBuild.titleRadius);
    for (const player of getCachedPlayers()) {
      if (player.dimension.id !== state.plots.config.dimensionId) continue;
      const pid = getPlayerId(player);

      const expanded = {
        x: player.location.x,
        y: player.location.y,
        z: player.location.z,
      };
      const slot = getPlotSlotsList().find((s) =>
        expanded.x >= s.min.x - radius && expanded.x <= s.max.x + radius &&
        expanded.y >= s.min.y - radius && expanded.y <= s.max.y + radius &&
        expanded.z >= s.min.z - radius && expanded.z <= s.max.z + radius
      ) ?? getPlotForLocation(player.location);

      const currentId = slot?.id;
      if (lastSeenPlotByPlayerId[pid] !== currentId) {
        lastSeenPlotByPlayerId[pid] = currentId;
        if (slot) {
          player.onScreenDisplay.setTitle(getPlotTitle(slot), {
            fadeInDuration: 5,
            stayDuration: 25,
            fadeOutDuration: 10,
          });
        }
      }
    }
  }, 20);

  system.runInterval(() => {
    if (!isFeatureEnabled("plots")) return;
    processQueuedPlotBuildJobs();
  }, 20);

  system.runInterval(() => {
    if (!isFeatureEnabled("generators")) return;
    processGenerators();
  }, 20);
}
