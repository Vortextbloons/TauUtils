import { system, world, type ItemStack, type Player } from "@minecraft/server";
import { describeGeneratorStack, getPlacedGeneratorAtLocation, handleGeneratorUseOnBlock, isGeneratorBlock } from "../generators";
import { tryHandleCrateInteract } from "../crates";
import { tryHandleTauItemTrigger } from "../tau-items";
import { shouldCancelAreaBlockBreak, shouldCancelAreaBlockPlace, shouldCancelAreaEntityInteract, shouldCancelAreaItemUse } from "../custom-areas";
import { shouldCancelClaimBlockBreak, shouldCancelClaimBlockPlace, shouldCancelClaimEntityInteract, shouldCancelClaimItemUse } from "../claims";
import { shouldCancelLootChestBreak } from "../loot-chests";
import { enforceBannedItemUse } from "../moderation/banned-items";
import {
  asPlayer,
  getInventoryContainer,
  getMenuIdFromNameTag,
  getMenuIdFromTags,
  getPlayerId,
  incrementStat,
  isFeatureEnabled,
  isOperator,
  normalizeKey,
  saveLootChests,
  state,
  tell,
} from "../storage";
import { beginLootChestRefillCountdown } from "../loot-chests/core";

const generatorMenuOpenByPlayerId = new Map<string, number>();

function openGeneratorMenuOnce(player: ReturnType<typeof asPlayer>, placed: { definitionId: string; x: number; y: number; z: number; dimensionId: string }): void {
  if (!player) return;
  const playerId = getPlayerId(player);
  const now = Date.now();
  const lastOpenAt = generatorMenuOpenByPlayerId.get(playerId) ?? 0;
  if (now - lastOpenAt < 600) return;
  generatorMenuOpenByPlayerId.set(playerId, now);
  system.run(() => {
    if (!player.isValid) return;
    void import("../ui").then((formsUi) => {
      void formsUi.showGeneratorUpgradeMenu(player, placed.definitionId, { x: placed.x, y: placed.y, z: placed.z }, placed.dimensionId);
    });
  });
  system.runTimeout(() => {
    generatorMenuOpenByPlayerId.delete(playerId);
  }, 20);
}

/** Called from the player-leave cleanup path. */
export function clearGeneratorMenuForPlayer(playerId: string): void {
  generatorMenuOpenByPlayerId.delete(playerId);
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

export function registerInteractionEvents(): void {
  world.afterEvents.itemUse.subscribe((event) => {
    const player = asPlayer(event.source);
    if (player && shouldCancelAreaItemUse(player)) return;
    if (player && shouldCancelClaimItemUse(player)) return;

    if (player && isFeatureEnabled("items")) {
      const handled = tryHandleTauItemTrigger(player, "use_air", event.itemStack, {
        location: player.location,
      });
      if (handled.matched && handled.message) tell(player, handled.message);
    }

    if (!isFeatureEnabled("forms") || !isFeatureEnabled("bindings")) return;
    const menuId = resolveItemMenu(event.itemStack);
    if (!menuId) return;
    const source = event.source;
    system.run(async () => {
      if (!source.isValid) return;
      const { openFormById } = await import("../ui");
      openFormById(source, menuId);
    });
  });

  world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    if (shouldCancelAreaEntityInteract(event.player)) return;
    if (shouldCancelClaimEntityInteract(event.player)) return;
    if (!isFeatureEnabled("forms") || !isFeatureEnabled("bindings")) return;
    const menuId = resolveEntityMenu(event.target);
    if (!menuId) return;
    const interactingPlayer = event.player;
    system.run(async () => {
      if (!interactingPlayer.isValid) return;
      const { openFormById } = await import("../ui");
      openFormById(interactingPlayer, menuId);
    });
  });

  system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "tau") return;
    const player = asPlayer(event.sourceEntity) ?? asPlayer(event.initiator);
    if (!player) return;
    if (!isOperator(player)) {
      tell(player, "Operator permissions are required.");
      return;
    }
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
        if (!player.isValid) return;
        const { openFormById } = await import("../ui");
        openFormById(player, arg);
      });
    } else if (subcommand === "creator") {
      if (!isFeatureEnabled("creator")) {
        tell(player, "Creator is disabled.");
        return;
      }
      system.run(async () => {
        if (!player.isValid) return;
        const { showCreatorMenu } = await import("../ui");
        showCreatorMenu(player);
      });
    }
  });

  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (shouldCancelAreaBlockPlace(event.player, event.block.location, event.player.dimension.id, event.block.typeId)) return;
    if (shouldCancelClaimBlockPlace(event.player, event.block.location, event.player.dimension.id)) return;
    if (!isFeatureEnabled("stats")) return;
    incrementStat(event.player, "blocksPlaced", 1);
  });

  world.afterEvents.playerBreakBlock.subscribe((event) => {
    if (!isFeatureEnabled("stats")) return;
    incrementStat(event.player, "blocksBroken", 1);
  });

  const beforePlaceBlock = (world.beforeEvents as unknown as { playerPlaceBlock?: { subscribe(callback: (event: { player: Player; block: { location: { x: number; y: number; z: number } }; permutationToPlace: { type: { id: string } }; cancel: boolean }) => void): void } }).playerPlaceBlock;
  if (!beforePlaceBlock) {
    console.warn("[TauUtils] world.beforeEvents.playerPlaceBlock is unavailable: area/claim place protection runs observe-only (afterEvents cannot cancel).");
  }
  beforePlaceBlock?.subscribe((event) => {
    if (shouldCancelAreaBlockPlace(event.player, event.block.location, event.player.dimension.id, event.permutationToPlace.type.id)) {
      event.cancel = true;
      tell(event.player, "§cYou cannot place blocks in this area.");
      return;
    }
    if (shouldCancelClaimBlockPlace(event.player, event.block.location, event.player.dimension.id)) {
      event.cancel = true;
      tell(event.player, "§cYou cannot place blocks in this claim.");
    }
  });

  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (isFeatureEnabled("moderation") && enforceBannedItemUse(event.player, event.itemStack, event)) return;

    if (shouldCancelAreaItemUse(event.player, event.block.location, event.player.dimension.id)) {
      event.cancel = true;
      tell(event.player, "§cYou cannot use items in this area.");
      return;
    }
    if (shouldCancelClaimItemUse(event.player, event.block.location, event.player.dimension.id)) {
      event.cancel = true;
      tell(event.player, "§cYou cannot use items in this claim.");
      return;
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

    if (isFeatureEnabled("lootChests")) {
      // RAM mutation stays synchronous; dynamic-property persistence is deferred
      // (before-events are read-only for storage writes).
      const countdown = beginLootChestRefillCountdown({
        dimensionId: event.player.dimension.id,
        x: event.block.location.x,
        y: event.block.location.y,
        z: event.block.location.z,
      });
      if (countdown.savedChange) {
        system.run(() => {
          try {
            saveLootChests();
          } catch {
            // ignore deferred save errors
          }
        });
      }
    }

    if (!isFeatureEnabled("generators")) return;
    const heldStack = getInventoryContainer(event.player)?.getItem(event.player.selectedSlotIndex);
    if (!describeGeneratorStack(heldStack)) return;
    event.cancel = true;
    const placingPlayer = event.player;
    const targetLocation = { x: event.block.location.x, y: event.block.location.y, z: event.block.location.z };
    const targetDimensionId = event.player.dimension.id;
    const targetBlockFace = event.blockFace;
    system.run(() => {
      if (!placingPlayer.isValid) return;
      const currentHeld = getInventoryContainer(placingPlayer)?.getItem(placingPlayer.selectedSlotIndex);
      const placed = handleGeneratorUseOnBlock(placingPlayer, targetLocation, targetDimensionId, currentHeld, targetBlockFace);
      if (!placed.message) return;
      tell(placingPlayer, placed.ok ? `§a[Generators] ${placed.message}` : `§c[Generators] ${placed.message}`);
    });
  });

  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (isFeatureEnabled("lootChests") && shouldCancelLootChestBreak(event.player, event.block.location, event.player.dimension.id)) {
      event.cancel = true;
      tell(event.player, "§cYou cannot break managed loot chests.");
      return;
    }
    if (shouldCancelAreaBlockBreak(event.player, event.block.location, event.player.dimension.id, event.block.typeId)) {
      event.cancel = true;
      tell(event.player, "§cYou cannot break blocks in this area.");
      return;
    }
    if (shouldCancelClaimBlockBreak(event.player, event.block.location, event.player.dimension.id)) {
      event.cancel = true;
      tell(event.player, "§cYou cannot break blocks in this claim.");
      return;
    }
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
}
