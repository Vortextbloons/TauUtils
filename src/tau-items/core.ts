import { EntityComponentTypes, ItemComponentTypes, ItemStack, Player, system } from "@minecraft/server";
import { commandStripSlash, getInventoryContainer, getPlayerId, getScore, saveTauItems, setScore, state } from "../storage";
import { renderCommandTemplate as renderSharedCommandTemplate } from "../shared/templates";
import { type TauItemAction, type TauItemConsumptionMode, type TauItemDefinition, type TauItemTriggerType } from "../types";

type TriggerContext = {
  location?: { x: number; y: number; z: number };
  targetEntity?: any;
};

type TriggerResult = {
  matched: boolean;
  cancel: boolean;
  message?: string;
};

const TAU_ITEM_MARKER_PREFIX = "§0TauItem:";
const TAU_ITEM_USES_PREFIX = "§0TauUses:";
const cooldownEndsByKey = new Map<string, number>();

function normalizeId(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeItemId(value: string): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return raw;
  if (raw.includes(":")) return raw;
  return `minecraft:${raw}`;
}

function markerLine(itemId: string): string {
  return `${TAU_ITEM_MARKER_PREFIX}${normalizeId(itemId)}`;
}

function usesLine(remainingUses: number): string {
  return `${TAU_ITEM_USES_PREFIX}${Math.max(0, Math.floor(remainingUses))}`;
}

function readTauItemId(stack?: ItemStack): string | undefined {
  if (!stack) return undefined;
  for (const line of stack.getLore()) {
    const trimmed = String(line).trim();
    if (!trimmed.startsWith(TAU_ITEM_MARKER_PREFIX)) continue;
    const id = normalizeId(trimmed.slice(TAU_ITEM_MARKER_PREFIX.length));
    if (id) return id;
  }
  return undefined;
}

function readRemainingUses(stack?: ItemStack): number | undefined {
  if (!stack) return undefined;
  for (const line of stack.getLore()) {
    const trimmed = String(line).trim();
    if (!trimmed.startsWith(TAU_ITEM_USES_PREFIX)) continue;
    const value = Number(trimmed.slice(TAU_ITEM_USES_PREFIX.length));
    if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  }
  return undefined;
}

function writeRemainingUses(stack: ItemStack, remainingUses: number): void {
  const marker = markerLine(readTauItemId(stack) ?? "");
  const visibleLore = stack.getLore().filter((line) => {
    const trimmed = String(line).trim();
    return !trimmed.startsWith(TAU_ITEM_MARKER_PREFIX) && !trimmed.startsWith(TAU_ITEM_USES_PREFIX);
  });
  visibleLore.push(usesLine(remainingUses));
  if (marker.trim().length > 0) visibleLore.push(marker);
  stack.setLore(visibleLore);
}

function getTauItemFromStack(stack?: ItemStack): TauItemDefinition | undefined {
  const id = readTauItemId(stack);
  if (!id) return undefined;
  return state.tauItems.items[id];
}

function actionBar(player: Player, text: string): void {
  try {
    player.onScreenDisplay.setActionBar(text);
  } catch {
    // ignore
  }
}

function playFizzle(player: Player): void {
  const x = Math.floor(player.location.x);
  const y = Math.floor(player.location.y);
  const z = Math.floor(player.location.z);
  try {
    player.dimension.runCommand(`playsound random.break @a[name="${player.name.replace(/"/g, '\\"')}"] ${x} ${y} ${z} 0.4 1.8`);
  } catch {
    // ignore
  }
}

function cooldownKey(player: Player, itemId: string): string {
  return `${getPlayerId(player)}:${normalizeId(itemId)}`;
}

function remainingCooldownMs(player: Player, itemId: string): number {
  const endsAt = cooldownEndsByKey.get(cooldownKey(player, itemId)) ?? 0;
  return Math.max(0, endsAt - Date.now());
}

function setCooldown(player: Player, itemId: string, seconds: number): void {
  const ms = Math.max(0, Math.floor(seconds * 1000));
  cooldownEndsByKey.set(cooldownKey(player, itemId), Date.now() + ms);
}

function consumeHeldTauItem(player: Player, expected: TauItemDefinition): boolean {
  const inventory = getInventoryContainer(player);
  if (!inventory) return false;
  const held = inventory.getItem(player.selectedSlotIndex);
  if (!held) return false;
  if (normalizeItemId(held.typeId) !== normalizeItemId(expected.baseItemId)) return false;
  if (readTauItemId(held) !== expected.id) return false;

  const remainingUses = readRemainingUses(held);
  if (expected.maxUses !== undefined && expected.maxUses > 0) {
    const current = remainingUses ?? expected.maxUses;
    const next = current - 1;
    if (next <= 0) {
      inventory.setItem(player.selectedSlotIndex, undefined);
    } else {
      writeRemainingUses(held, next);
      inventory.setItem(player.selectedSlotIndex, held);
    }
    return true;
  }

  if (held.amount > 1) {
    held.amount -= 1;
    inventory.setItem(player.selectedSlotIndex, held);
  } else {
    inventory.setItem(player.selectedSlotIndex, undefined);
  }
  return true;
}

function damageHeldTauItem(player: Player, expected: TauItemDefinition): boolean {
  const inventory = getInventoryContainer(player);
  if (!inventory) return false;
  const held = inventory.getItem(player.selectedSlotIndex);
  if (!held) return false;
  if (normalizeItemId(held.typeId) !== normalizeItemId(expected.baseItemId)) return false;
  if (readTauItemId(held) !== expected.id) return false;

  const remainingUses = readRemainingUses(held);
  if (expected.maxUses !== undefined && expected.maxUses > 0) {
    const next = (remainingUses ?? expected.maxUses) - 1;
    if (next <= 0) {
      inventory.setItem(player.selectedSlotIndex, undefined);
    } else {
      writeRemainingUses(held, next);
      inventory.setItem(player.selectedSlotIndex, held);
    }
    return true;
  }

  const durability = held.getComponent(ItemComponentTypes.Durability);
  if (!durability) return true;
  try {
    const next = durability.damage + 1;
    durability.damage = next;
    if (next >= durability.maxDurability) {
      inventory.setItem(player.selectedSlotIndex, undefined);
    } else {
      inventory.setItem(player.selectedSlotIndex, held);
    }
  } catch {
    return false;
  }
  return true;
}

function applyConsumption(player: Player, expected: TauItemDefinition, mode: TauItemConsumptionMode): boolean {
  if (mode === "none") return true;
  if (mode === "consume_item") return consumeHeldTauItem(player, expected);
  if (mode === "damage_durability") return damageHeldTauItem(player, expected);
  return true;
}

function hasRequirements(player: Player, def: TauItemDefinition): { ok: boolean; message?: string } {
  if (def.requiredTag && !player.hasTag(def.requiredTag)) {
    return { ok: false, message: `§cRequires tag: ${def.requiredTag}` };
  }

  const remaining = remainingCooldownMs(player, def.id);
  if (remaining > 0) {
    return { ok: false, message: `§cAbility on cooldown: ${(remaining / 1000).toFixed(1)}s` };
  }

  if (!def.cost || def.cost.amount <= 0) return { ok: true };

  if (def.cost.type === "money") {
    const objective = def.cost.objective || state.pay.config.currencyObjective;
    const current = getScore(player, objective);
    if (current === undefined) return { ok: false, message: `§cMissing objective: ${objective}` };
    if (current < def.cost.amount) return { ok: false, message: `§cNeed $${def.cost.amount}` };
    return { ok: true };
  }

  if (def.cost.type === "xp") {
    const level = Number((player as any).level ?? 0);
    if (level < def.cost.amount) return { ok: false, message: `§cNeed ${def.cost.amount} XP levels` };
    return { ok: true };
  }

  if (def.cost.type === "health") {
    const health = player.getComponent(EntityComponentTypes.Health) as any;
    const current = Number(health?.currentValue ?? 20);
    if (current <= def.cost.amount) return { ok: false, message: "§cNot enough health" };
    return { ok: true };
  }

  return { ok: true };
}

function payCost(player: Player, def: TauItemDefinition): boolean {
  if (!def.cost || def.cost.amount <= 0) return true;

  if (def.cost.type === "money") {
    const objective = def.cost.objective || state.pay.config.currencyObjective;
    const current = getScore(player, objective);
    if (current === undefined || current < def.cost.amount) return false;
    return setScore(player, objective, current - def.cost.amount);
  }

  if (def.cost.type === "xp") {
    try {
      player.runCommand(`xp -${Math.max(1, Math.floor(def.cost.amount))}L @s`);
      return true;
    } catch {
      return false;
    }
  }

  if (def.cost.type === "health") {
    const health = player.getComponent(EntityComponentTypes.Health) as any;
    if (!health?.setCurrentValue) return false;
    const current = Number(health.currentValue ?? 20);
    if (current <= def.cost.amount) return false;
    health.setCurrentValue(Math.max(1, current - def.cost.amount));
    return true;
  }

  return true;
}

function renderCommandTemplate(command: string, player: Player, context: TriggerContext): string {
  const loc = context.location ?? player.location;
  return renderSharedCommandTemplate(command, {
    player,
    extra: {
      x: Math.floor(loc.x),
      y: Math.floor(loc.y),
      z: Math.floor(loc.z),
      dimension: player.dimension.id,
    },
  });
}

function runCommandChain(player: Player, commands: string[], context: TriggerContext): void {
  for (const raw of commands) {
    const command = renderCommandTemplate(raw, player, context);
    if (!command.trim()) continue;
    try {
      player.runCommand(commandStripSlash(command));
    } catch {
      // ignore command failures
    }
  }
}

function runAction(player: Player, action: TauItemAction, context: TriggerContext): void {
  if (action.type === "command") {
    runCommandChain(player, action.commands, context);
    return;
  }

  if (action.type === "sound") {
    const x = Math.floor(player.location.x);
    const y = Math.floor(player.location.y);
    const z = Math.floor(player.location.z);
    try {
      player.dimension.runCommand(`playsound ${action.soundId} @a[name="${player.name.replace(/"/g, '\\"')}"] ${x} ${y} ${z} ${Math.max(0, Number(action.volume ?? 1))} ${Math.max(0.01, Number(action.pitch ?? 1))}`);
    } catch {
      // ignore
    }
    return;
  }

  if (action.type === "particle") {
    const count = Math.max(1, Math.floor(action.count ?? 8));
    const spread = Math.max(0, Number(action.spread ?? 1.2));
    for (let i = 0; i < count; i++) {
      try {
        player.dimension.spawnParticle(action.particleId, {
          x: player.location.x + (Math.random() - 0.5) * spread,
          y: player.location.y + 1 + Math.random() * spread,
          z: player.location.z + (Math.random() - 0.5) * spread,
        });
      } catch {
        // ignore
      }
    }
    return;
  }

  if (action.type === "effect") {
    const seconds = Math.max(1, Math.ceil(action.durationTicks / 20));
    const amp = Math.max(0, Math.floor(action.amplifier ?? 0));
    try {
      player.runCommand(`effect @s ${action.effectId} ${seconds} ${amp} true`);
    } catch {
      // ignore
    }
    return;
  }

  if (action.type === "projectile") {
    try {
      const spawnAt = { x: player.location.x, y: player.location.y + 1.5, z: player.location.z };
      const projectile = player.dimension.spawnEntity(action.entityId as any, spawnAt) as any;
      const dir = player.getViewDirection();
      const speed = Math.max(0.1, Number(action.speed ?? 1.6));
      if (projectile?.applyImpulse) projectile.applyImpulse({ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed });
    } catch {
      // ignore
    }
    return;
  }

  if (action.type === "aoe") {
    const radius = Math.max(1, Number(action.radius));
    const entities = player.dimension.getEntities({ location: player.location, maxDistance: radius });
    for (const target of entities) {
      if (target.id === player.id) continue;
      if (action.mode === "damage") {
        try {
          (target as any).applyDamage?.(Math.max(0, Number(action.amount)));
        } catch {
          // ignore
        }
      } else if (action.mode === "heal") {
        try {
          const health = target.getComponent(EntityComponentTypes.Health) as any;
          if (!health?.setCurrentValue) continue;
          const current = Number(health.currentValue ?? 0);
          const max = Number(health.defaultValue ?? current);
          health.setCurrentValue(Math.min(max, current + Math.max(0, Number(action.amount))));
        } catch {
          // ignore
        }
      } else if (action.mode === "knockback") {
        const dx = target.location.x - player.location.x;
        const dz = target.location.z - player.location.z;
        const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
        try {
          const strength = Math.max(0.2, Number(action.amount) * 0.35);
          if (typeof (target as any).applyKnockback === "function") {
            (target as any).applyKnockback(dx / len, dz / len, strength, 0.35);
          } else {
            (target as any).applyImpulse?.({ x: (dx / len) * strength, y: 0.25, z: (dz / len) * strength });
          }
        } catch {
          // ignore
        }
      }
    }
  }
}

function executeTauItem(player: Player, def: TauItemDefinition, context: TriggerContext): void {
  if (!payCost(player, def)) {
    actionBar(player, "§cUnable to pay item cost.");
    playFizzle(player);
    return;
  }

  if (!applyConsumption(player, def, def.consumption)) {
    actionBar(player, "§cUnable to consume item use.");
    playFizzle(player);
    return;
  }

  if (def.cooldownSeconds > 0) setCooldown(player, def.id, def.cooldownSeconds);
  for (const action of def.actions) {
    runAction(player, action, context);
  }
}

export function tryHandleTauItemTrigger(player: Player, trigger: TauItemTriggerType, itemStack: ItemStack | undefined, context: TriggerContext = {}): TriggerResult {
  if (!state.tauItems.config.enabled) return { matched: false, cancel: false };
  const def = getTauItemFromStack(itemStack);
  if (!def) return { matched: false, cancel: false };

  if (!def.triggers.includes(trigger)) {
    return { matched: true, cancel: false };
  }

  const req = hasRequirements(player, def);
  if (!req.ok) {
    const message = req.message ?? "§cCannot use this item right now.";
    actionBar(player, message);
    playFizzle(player);
    return { matched: true, cancel: Boolean(def.cancelVanilla ?? true), message };
  }

  system.runTimeout(() => {
    const inventory = getInventoryContainer(player);
    const selected = inventory?.getItem(player.selectedSlotIndex);
    const currentDef = getTauItemFromStack(selected);
    if (!currentDef || currentDef.id !== def.id) return;
    executeTauItem(player, def, context);
  }, 1);

  return { matched: true, cancel: Boolean(def.cancelVanilla ?? true) };
}

export function listTauItemIds(): string[] {
  return Object.keys(state.tauItems.items).sort((a, b) => a.localeCompare(b));
}

export function getTauItemDefinition(itemId: string): TauItemDefinition | undefined {
  return state.tauItems.items[normalizeId(itemId)];
}

export function createTauItemDefinition(id: string, displayName: string, baseItemId: string): { ok: boolean; message: string } {
  const normalized = normalizeId(id);
  if (!normalized) return { ok: false, message: "Item id is required." };
  if (state.tauItems.items[normalized]) return { ok: false, message: "That TauItem already exists." };
  state.tauItems.items[normalized] = {
    id: normalized,
    displayName: displayName.trim() || normalized,
    baseItemId: normalizeItemId(baseItemId),
    loreDescription: "Custom Tau item",
    triggers: ["use_air"],
    actions: [{ type: "sound", soundId: "random.levelup", volume: 0.6, pitch: 1 }, { type: "command", commands: ["say {player} used a TauItem"] }],
    cooldownSeconds: 5,
    consumption: "none",
    maxUses: undefined,
    cancelVanilla: true,
  };
  saveTauItems();
  return { ok: true, message: `Created TauItem ${normalized}.` };
}

export function updateTauItemDefinition(itemId: string, patch: Partial<TauItemDefinition>): { ok: boolean; message: string } {
  const def = getTauItemDefinition(itemId);
  if (!def) return { ok: false, message: "TauItem not found." };
  if (patch.displayName !== undefined) def.displayName = String(patch.displayName).trim() || def.displayName;
  if (patch.baseItemId !== undefined) def.baseItemId = normalizeItemId(patch.baseItemId);
  if (patch.loreDescription !== undefined) def.loreDescription = String(patch.loreDescription);
  if (patch.cooldownSeconds !== undefined) def.cooldownSeconds = Math.max(0, Number(patch.cooldownSeconds) || 0);
  if (patch.requiredTag !== undefined) def.requiredTag = String(patch.requiredTag).trim() || undefined;
  if (patch.cancelVanilla !== undefined) def.cancelVanilla = Boolean(patch.cancelVanilla);
  if (patch.consumption !== undefined) def.consumption = patch.consumption;
  if (patch.maxUses !== undefined) def.maxUses = Math.max(0, Math.floor(Number(patch.maxUses) || 0)) || undefined;
  if (patch.triggers !== undefined) def.triggers = patch.triggers.slice();
  if (patch.actions !== undefined) def.actions = patch.actions.slice();
  if (patch.cost !== undefined) def.cost = patch.cost;
  saveTauItems();
  return { ok: true, message: `Updated TauItem ${def.id}.` };
}

export function deleteTauItemDefinition(itemId: string): { ok: boolean; message: string } {
  const id = normalizeId(itemId);
  if (!state.tauItems.items[id]) return { ok: false, message: "TauItem not found." };
  delete state.tauItems.items[id];
  saveTauItems();
  return { ok: true, message: `Deleted TauItem ${id}.` };
}

function buildTauItemLore(def: TauItemDefinition): string[] {
  const lines: string[] = [];
  if (def.loreDescription && def.loreDescription.trim().length > 0) lines.push(`§7${def.loreDescription.trim()}`);
  if (def.maxUses !== undefined && def.maxUses > 0) lines.push(`§8Uses: §f${def.maxUses}`);
  lines.push(`§8CD: §f${def.cooldownSeconds}s`);
  lines.push(markerLine(def.id));
  return lines;
}

export function giveTauItem(player: Player, itemId: string, amount = 1): { ok: boolean; message: string } {
  const def = getTauItemDefinition(itemId);
  if (!def) return { ok: false, message: `TauItem not found: ${itemId}` };
  const stack = new ItemStack(normalizeItemId(def.baseItemId), Math.max(1, Math.floor(amount)));
  stack.nameTag = def.displayName;
  stack.setLore(buildTauItemLore(def));
  const inventory = getInventoryContainer(player);
  if (!inventory) return { ok: false, message: "Inventory unavailable." };
  const left = inventory.addItem(stack);
  if (left) return { ok: false, message: "Not enough inventory space." };
  return { ok: true, message: `Gave ${stack.amount}x ${def.displayName}.` };
}
