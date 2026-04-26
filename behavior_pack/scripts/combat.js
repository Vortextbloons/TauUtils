import { EntityComponentTypes, EquipmentSlot, system, world, } from "@minecraft/server";
import { asPlayer, getInventoryContainer, getPlayerId, isFeatureEnabled, state, tell } from "./storage";
const combatTagsByPlayerId = new Map();
const combatSnapshotsByPlayerId = new Map();
const pendingCombatLogouts = [];
const PENALTY_KEY_PREFIX = "tau:combat:penalty:";
const EQUIPMENT_SLOTS = [
    EquipmentSlot.Head,
    EquipmentSlot.Chest,
    EquipmentSlot.Legs,
    EquipmentSlot.Feet,
    EquipmentSlot.Offhand,
];
function nowMs() {
    return Date.now();
}
function penaltyKey(playerId) {
    return `${PENALTY_KEY_PREFIX}${playerId}`;
}
function formatCombatMessage(template, playerName) {
    return String(template ?? "").split("{player}").join(playerName);
}
function getCombatDurationMs() {
    const seconds = Math.max(1, Math.floor(Number(state.combat.config.combatTimeSeconds ?? 15)));
    return seconds * 1000;
}
function isCombatSystemEnabled() {
    return isFeatureEnabled("combat") && state.combat.config.enabled;
}
function clearCombatTag(player, playerId, notify) {
    combatTagsByPlayerId.delete(playerId);
    combatSnapshotsByPlayerId.delete(playerId);
    if (!notify)
        return;
    tell(player, state.combat.config.exitMessage);
}
function isTagged(player, playerId) {
    const entry = combatTagsByPlayerId.get(playerId);
    if (!entry)
        return false;
    if (entry.expiresAt > nowMs())
        return true;
    clearCombatTag(player, playerId, true);
    return false;
}
function hasActiveTag(playerId) {
    const entry = combatTagsByPlayerId.get(playerId);
    if (!entry)
        return false;
    if (entry.expiresAt > nowMs())
        return true;
    combatTagsByPlayerId.delete(playerId);
    combatSnapshotsByPlayerId.delete(playerId);
    return false;
}
function setCombatTag(player) {
    const id = getPlayerId(player);
    const tagged = isTagged(player, id);
    combatTagsByPlayerId.set(id, { expiresAt: nowMs() + getCombatDurationMs() });
    combatSnapshotsByPlayerId.set(id, captureCombatLoot(player));
    if (!tagged)
        tell(player, state.combat.config.enterMessage);
}
function captureCombatLoot(player) {
    const inventory = [];
    const equipment = [];
    const container = getInventoryContainer(player);
    if (container) {
        for (let slot = 0; slot < container.size; slot++) {
            try {
                const stack = container.getItem(slot);
                if (!stack)
                    continue;
                inventory.push(stack.clone());
            }
            catch {
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
                    if (!stack)
                        continue;
                    equipment.push(stack.clone());
                }
                catch {
                    continue;
                }
            }
        }
    }
    catch {
    }
    return { inventory, equipment };
}
function cloneCombatLoot(snapshot) {
    return {
        inventory: snapshot.inventory.map((stack) => stack.clone()),
        equipment: snapshot.equipment.map((stack) => stack.clone()),
    };
}
function clearInventoryAndEquipment(player) {
    try {
        const container = getInventoryContainer(player);
        if (container) {
            for (let slot = 0; slot < container.size; slot++) {
                try {
                    container.setItem(slot, undefined);
                }
                catch {
                    continue;
                }
            }
        }
    }
    catch {
    }
    try {
        const equippable = player.getComponent(EntityComponentTypes.Equippable);
        if (!equippable)
            return;
        for (const slotType of EQUIPMENT_SLOTS) {
            try {
                equippable.setEquipment(slotType, undefined);
            }
            catch {
                continue;
            }
        }
    }
    catch {
    }
}
function spawnDroppedItems(dimensionId, location, dropped) {
    if (dropped.length === 0)
        return [];
    const failed = [];
    try {
        const dimension = world.getDimension(dimensionId);
        for (const stack of dropped) {
            try {
                dimension.spawnItem(stack, location);
            }
            catch {
                failed.push(stack.clone());
            }
        }
    }
    catch {
        return dropped.map((stack) => stack.clone());
    }
    return failed;
}
function processPendingCombatLogouts() {
    if (pendingCombatLogouts.length === 0)
        return;
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
            world.setDynamicProperty(penaltyKey(logout.playerId), JSON.stringify({ droppedAt: nowMs() }));
            if (state.combat.config.announceLogouts) {
                world.sendMessage(formatCombatMessage(state.combat.config.logoutBroadcastMessage, logout.playerName));
            }
        }
    }
}
export function handleCombatJoin(player) {
    const playerId = getPlayerId(player);
    const key = penaltyKey(playerId);
    const penaltyRaw = world.getDynamicProperty(key);
    if (!penaltyRaw)
        return;
    world.setDynamicProperty(key, undefined);
    combatSnapshotsByPlayerId.delete(playerId);
    clearInventoryAndEquipment(player);
    tell(player, state.combat.config.rejoinPenaltyMessage);
}
export function handleCombatLeave(player) {
    const playerId = getPlayerId(player);
    if (!isCombatSystemEnabled()) {
        combatTagsByPlayerId.delete(playerId);
        return;
    }
    if (!hasActiveTag(playerId))
        return;
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
export function handleCombatDeath(player) {
    const id = getPlayerId(player);
    combatTagsByPlayerId.delete(id);
    combatSnapshotsByPlayerId.delete(id);
}
export function resolveCombatAttacker(damageSource) {
    const direct = asPlayer(damageSource.damagingEntity);
    if (direct)
        return direct;
    const projectile = damageSource.damagingProjectile;
    if (!projectile)
        return undefined;
    try {
        const projectileComp = projectile.getComponent(EntityComponentTypes.Projectile);
        return asPlayer(projectileComp?.owner);
    }
    catch {
        return undefined;
    }
}
export function resolveCombatProjectileAttacker(projectile, source) {
    const directSource = asPlayer(source);
    if (directSource)
        return directSource;
    try {
        const projectileComp = projectile.getComponent(EntityComponentTypes.Projectile);
        return asPlayer(projectileComp?.owner);
    }
    catch {
        return undefined;
    }
}
export function handleCombatDamage(victim, attacker) {
    if (!isCombatSystemEnabled())
        return;
    if (victim.id === attacker.id)
        return;
    setCombatTag(victim);
    setCombatTag(attacker);
}
export function shouldBlockCommandWhileTagged(player, message) {
    if (!isCombatSystemEnabled())
        return false;
    if (!state.combat.config.blockCommands)
        return false;
    const text = String(message ?? "").trim();
    if (!text.startsWith("/"))
        return false;
    const playerId = getPlayerId(player);
    if (!isTagged(player, playerId))
        return false;
    tell(player, state.combat.config.blockedCommandMessage);
    return true;
}
export function processCombatTags() {
    if (!isCombatSystemEnabled()) {
        combatTagsByPlayerId.clear();
        combatSnapshotsByPlayerId.clear();
        pendingCombatLogouts.length = 0;
        return;
    }
    processPendingCombatLogouts();
    const onlineById = new Map();
    for (const player of world.getAllPlayers()) {
        onlineById.set(getPlayerId(player), player);
    }
    for (const [playerId, entry] of combatTagsByPlayerId.entries()) {
        if (entry.expiresAt <= nowMs())
            continue;
        const player = onlineById.get(playerId);
        if (player)
            combatSnapshotsByPlayerId.set(playerId, captureCombatLoot(player));
    }
    const now = nowMs();
    for (const [playerId, entry] of combatTagsByPlayerId.entries()) {
        if (entry.expiresAt > now)
            continue;
        const player = onlineById.get(playerId);
        if (player)
            clearCombatTag(player, playerId, true);
        else
            combatTagsByPlayerId.delete(playerId);
    }
}
