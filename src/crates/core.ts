import { Block, ItemStack, Player, system, world } from "@minecraft/server";
import { getInventoryContainer, getPlayerId, getScore, saveCrates, setScore, state } from "../storage";
import { renderCommandTemplate } from "../shared/templates";
import { type CrateAnimationPreset, type CrateDefinition, type CrateParticlePreset, type CrateReward } from "../types";

type CrateInteractResult = {
  handled: boolean;
  message?: string;
};

type RewardGrantResult = {
  ok: boolean;
  message: string;
};

const KEY_MARKER_PREFIX = "§0[TAU_CRATE:";
const activePlayers = new Set<string>();
const activeLocations = new Set<string>();

function normalizeId(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeItemId(value: string): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return raw;
  if (raw.includes(":")) return raw;
  return `minecraft:${raw}`;
}

function blockKey(dimensionId: string, x: number, y: number, z: number): string {
  return `${dimensionId}:${Math.floor(x)}:${Math.floor(y)}:${Math.floor(z)}`;
}

function markerLine(crateId: string): string {
  return `${KEY_MARKER_PREFIX}${normalizeId(crateId)}]`;
}

function hasKeyForCrate(crate: CrateDefinition, stack?: ItemStack): boolean {
  if (!stack) return false;
  if (normalizeItemId(stack.typeId) !== normalizeItemId(crate.keyItemId)) return false;
  const lore = stack.getLore().map((line) => String(line).trim());
  return lore.includes(crate.keyLoreLine) && lore.includes(markerLine(crate.id));
}

function consumeHeldItem(player: Player): boolean {
  const inventory = getInventoryContainer(player);
  if (!inventory) return false;
  const held = inventory.getItem(player.selectedSlotIndex);
  if (!held) return false;
  if (held.amount > 1) {
    held.amount -= 1;
    inventory.setItem(player.selectedSlotIndex, held);
  } else {
    inventory.setItem(player.selectedSlotIndex, undefined);
  }
  return true;
}

function isKeyForCrateInHand(player: Player, crate: CrateDefinition): boolean {
  const inventory = getInventoryContainer(player);
  if (!inventory) return false;
  const held = inventory.getItem(player.selectedSlotIndex);
  return hasKeyForCrate(crate, held);
}

function asTitleText(value: string): string {
  return JSON.stringify({ rawtext: [{ text: value }] });
}

function showTitle(player: Player, title: string, subtitle?: string, fadeIn = 2, stay = 20, fadeOut = 6): void {
  try {
    player.runCommand(`title @s times ${Math.max(0, Math.floor(fadeIn))} ${Math.max(0, Math.floor(stay))} ${Math.max(0, Math.floor(fadeOut))}`);
    player.runCommand(`titleraw @s title ${asTitleText(title)}`);
    if (subtitle !== undefined) player.runCommand(`titleraw @s subtitle ${asTitleText(subtitle)}`);
  } catch {
    // ignore display errors
  }
}

function playSound(player: Player, soundId: string, pitch = 1, volume = 1): void {
  const x = Math.floor(player.location.x);
  const y = Math.floor(player.location.y);
  const z = Math.floor(player.location.z);
  try {
    player.dimension.runCommand(`playsound ${soundId} @a[name="${player.name.replace(/"/g, '\\"')}"] ${x} ${y} ${z} ${Math.max(0, volume)} ${Math.max(0.01, pitch)}`);
  } catch {
    // ignore sound errors
  }
}

function getPresetEffect(preset: CrateAnimationPreset): { title: string; accent: string; chestSound: string; clickSound: string; revealSound: string; } {
  switch (preset) {
    case "ember":
      return { title: "§c§lEMBER CRATE", accent: "§6", chestSound: "random.fuse", clickSound: "random.click", revealSound: "random.explode" };
    case "frost":
      return { title: "§b§lFROST CRATE", accent: "§b", chestSound: "random.chestopen", clickSound: "random.click", revealSound: "random.levelup" };
    case "void":
      return { title: "§5§lVOID CRATE", accent: "§5", chestSound: "mob.endermen.portal", clickSound: "random.click", revealSound: "mob.enderdragon.growl" };
    case "arcane":
    default:
      return { title: "§d§lARCANE CRATE", accent: "§d", chestSound: "random.chestopen", clickSound: "random.click", revealSound: "random.levelup" };
  }
}

function getParticlePreset(preset: CrateParticlePreset): { spin: string; burst: string } {
  switch (preset) {
    case "ember":
      return { spin: "minecraft:basic_flame_particle", burst: "minecraft:basic_flame_particle" };
    case "frost":
      return { spin: "minecraft:basic_smoke_particle", burst: "minecraft:totem_particle" };
    case "void":
      return { spin: "minecraft:portal_directional", burst: "minecraft:endrod_particle" };
    case "arcane":
    default:
      return { spin: "minecraft:totem_particle", burst: "minecraft:totem_particle" };
  }
}

function spawnCrateParticles(player: Player, particleId: string, count = 6): void {
  const dim = player.dimension;
  const x = player.location.x;
  const y = player.location.y + 1;
  const z = player.location.z;
  try {
    for (let i = 0; i < count; i++) {
      dim.spawnParticle(particleId, { x: x + (Math.random() - 0.5) * 1.5, y: y + Math.random() * 1.2, z: z + (Math.random() - 0.5) * 1.5 });
    }
  } catch {
    // ignore particle errors
  }
}

function chooseWeightedReward(rewards: CrateReward[]): CrateReward | undefined {
  const valid = rewards.filter((reward) => Number.isFinite(reward.weight) && reward.weight > 0);
  if (valid.length === 0) return undefined;
  const total = valid.reduce((sum, reward) => sum + reward.weight, 0);
  let roll = Math.random() * total;
  for (const reward of valid) {
    roll -= reward.weight;
    if (roll <= 0) return reward;
  }
  return valid[valid.length - 1];
}

function sampleRewardName(crate: CrateDefinition, winner: CrateReward, winnerBias: number): string {
  const names = crate.rewards.map((reward) => reward.label).filter((label) => label.length > 0);
  if (names.length === 0) return winner.label;
  if (Math.random() < winnerBias) return winner.label;
  return names[Math.floor(Math.random() * names.length)] ?? winner.label;
}

function giveItemReward(player: Player, reward: Extract<CrateReward, { type: "item" }>): RewardGrantResult {
  let stack: ItemStack;
  try {
    stack = new ItemStack(normalizeItemId(reward.itemId), Math.max(1, Math.floor(reward.amount || 1)));
    if (reward.displayName && reward.displayName.trim().length > 0) stack.nameTag = reward.displayName;
    else if (reward.nameTag && reward.nameTag.trim().length > 0) stack.nameTag = reward.nameTag;
    if (reward.lore && reward.lore.length > 0) stack.setLore(reward.lore);
    if (reward.customData) stack.setDynamicProperty("tau:custom_data", reward.customData);
    const placeComp = stack.getComponent("minecraft:can_place_on") as any;
    if (placeComp && reward.canPlaceOn && reward.canPlaceOn.length > 0) placeComp.blocks = reward.canPlaceOn;
    const destroyComp = stack.getComponent("minecraft:can_destroy") as any;
    if (destroyComp && reward.canDestroy && reward.canDestroy.length > 0) destroyComp.blocks = reward.canDestroy;
    if (reward.enchantments && reward.enchantments.length > 0) {
      const enchantComp = stack.getComponent("minecraft:enchantable") as any;
      if (enchantComp?.addEnchantments) {
        enchantComp.addEnchantments(reward.enchantments.map((entry) => ({ type: { id: entry.id }, level: entry.level })));
      }
    }
    if (reward.durability !== undefined && reward.maxDurability !== undefined) {
      const durability = stack.getComponent("minecraft:durability") as any;
      if (durability) durability.damage = Math.max(0, Math.min(reward.maxDurability, reward.durability));
    }
  } catch {
    return { ok: false, message: `Invalid item id for reward: ${reward.itemId}` };
  }
  const inventory = getInventoryContainer(player);
  if (!inventory) {
    try {
      player.dimension.spawnItem(stack, player.location);
      return { ok: true, message: `Dropped ${reward.label} at your feet.` };
    } catch {
      return { ok: false, message: `Unable to give ${reward.label}.` };
    }
  }
  try {
    const left = inventory.addItem(stack);
    if (left) {
      try {
        player.dimension.spawnItem(left, player.location);
        return { ok: true, message: `Inventory full, dropped ${reward.label} at your feet.` };
      } catch {
        return { ok: false, message: `Inventory full and unable to drop ${reward.label}.` };
      }
    }
    return { ok: true, message: `Granted ${reward.label}.` };
  } catch {
    return { ok: false, message: `Failed to add ${reward.label} to inventory.` };
  }
}

function giveReward(player: Player, crate: CrateDefinition, reward: CrateReward): RewardGrantResult {
  if (reward.type === "item") {
    return giveItemReward(player, reward);
  }

  if (reward.type === "score") {
    const current = getScore(player, reward.objective);
    if (current !== undefined) {
      setScore(player, reward.objective, current + Math.max(0, Math.floor(reward.amount)));
    }
    return { ok: true, message: `Granted ${reward.label}.` };
  }

  if (reward.type === "tag") {
    player.addTag(reward.tag);
    return { ok: true, message: `Granted ${reward.label}.` };
  }

  if (reward.type === "command") {
    try {
      player.runCommand(renderCommandTemplate(reward.command, {
        player,
        extra: {
          crate: crate.displayName,
          crate_id: crate.id,
          reward: reward.label,
          x: Math.floor(player.location.x),
          y: Math.floor(player.location.y),
          z: Math.floor(player.location.z),
          dimension: player.dimension.id,
        },
      }));
      return { ok: true, message: `Granted ${reward.label}.` };
    } catch {
      return { ok: false, message: `Failed command reward: ${reward.label}.` };
    }
  }

  return { ok: false, message: "Unknown reward type." };
}

function maybeBroadcastRareWin(player: Player, crate: CrateDefinition, reward: CrateReward): void {
  if (!crate.broadcastRareWins) return;
  if (reward.weight > crate.rareBroadcastWeightThreshold) return;
  world.sendMessage(`§l§6[RARE WIN]§r §e${player.name}§7 won §b${reward.label}§7 from §6${crate.displayName}§7!`);
}

function runRevealSequence(player: Player, crate: CrateDefinition, reward: CrateReward, done: () => void): void {
  const preset = getPresetEffect(crate.animationPreset ?? "arcane");
  const particlePreset = getParticlePreset(crate.particlePreset ?? "arcane");
  showTitle(player, `${preset.accent}§lUNBOXING...`, "§7Authenticating Key...", 0, 10, 4);
  playSound(player, preset.chestSound, 1.0, 1.0);
  spawnCrateParticles(player, particlePreset.spin, 12);

  const blurSteps = 15;
  const brakingDelays = [2, 3, 5, 8, 10, 14, 20];

  const runBlur = (index: number) => {
    if (index >= blurSteps) {
      runBrake(0);
      return;
    }
    showTitle(player, "§k||||||||||", sampleRewardName(crate, reward, 0.08), 0, 4, 0);
    spawnCrateParticles(player, particlePreset.spin, 4);
    playSound(player, preset.clickSound, 2.0, 0.3);
    system.runTimeout(() => runBlur(index + 1), 2);
  };

  const runBrake = (index: number) => {
    if (index >= brakingDelays.length) {
      showTitle(player, `§b§l${reward.label.toUpperCase()}`, "§a§lLOOT CLAIMED!", 3, 100, 40);
      spawnCrateParticles(player, particlePreset.burst, 20);
      playSound(player, preset.revealSound, 1.0, 1.0);
      playSound(player, "random.explode", 0.6, 0.2);
      system.runTimeout(done, 100);
      return;
    }

    const progress = (index + 1) / brakingDelays.length;
    showTitle(player, "§e§lROLLING", sampleRewardName(crate, reward, 0.2 + progress * 0.7), 0, 6, 0);
    spawnCrateParticles(player, particlePreset.spin, 2 + Math.floor(progress * 6));
    playSound(player, preset.clickSound, 1.7 - progress * 0.6, 0.25);
    system.runTimeout(() => runBrake(index + 1), brakingDelays[index]);
  };

  system.runTimeout(() => runBlur(0), 10);
}

function findCrateAtBlock(block: Block): { crate: CrateDefinition; locationKey: string } | undefined {
  const key = blockKey(block.dimension.id, block.location.x, block.location.y, block.location.z);
  const location = state.crates.locations[key];
  if (!location) return undefined;
  const crate = state.crates.crates[normalizeId(location.crateId)];
  if (!crate) return undefined;
  return { crate, locationKey: key };
}

function cleanupInvalidCrate(block: Block, entry: { crate: CrateDefinition; locationKey: string }): boolean {
  const blockType = normalizeItemId(block.typeId);
  const expectedType = normalizeItemId(entry.crate.crateBlockId);
  if (blockType === expectedType) return false;
  delete state.crates.locations[entry.locationKey];
  saveCrates();
  return true;
}

export function tryHandleCrateInteract(player: Player, block: Block, heldItem?: ItemStack): CrateInteractResult {
  if (!state.crates.config.enabled) return { handled: false };
  const entry = findCrateAtBlock(block);
  if (!entry) return { handled: false };

  if (cleanupInvalidCrate(block, entry)) {
    return { handled: true, message: "Crate entry was stale and has been cleaned up." };
  }

  if (!hasKeyForCrate(entry.crate, heldItem)) {
    return { handled: true, message: `You need a valid ${entry.crate.displayName} key.` };
  }
  system.runTimeout(() => {
    const pid = getPlayerId(player);
    if (activePlayers.has(pid)) return;
    if (activeLocations.has(entry.locationKey)) return;
    if (!isKeyForCrateInHand(player, entry.crate)) return;
    if (!consumeHeldItem(player)) return;

    const reward = chooseWeightedReward(entry.crate.rewards);
    if (!reward) return;

    activePlayers.add(pid);
    activeLocations.add(entry.locationKey);

    runRevealSequence(player, entry.crate, reward, () => {
      const result = giveReward(player, entry.crate, reward);
      if (!result.ok) {
        try {
          player.sendMessage(`§c[Crate] ${result.message}`);
        } catch {
          // ignore
        }
      } else if (result.message) {
        try {
          player.sendMessage(`§a[Crate] ${result.message}`);
        } catch {
          // ignore
        }
      }
      maybeBroadcastRareWin(player, entry.crate, reward);
      activePlayers.delete(pid);
      activeLocations.delete(entry.locationKey);
    });
  }, 1);

  return { handled: true };
}

export function giveCrateKey(player: Player, crateId: string, amount: number): { ok: boolean; message: string } {
  const crate = state.crates.crates[normalizeId(crateId)];
  if (!crate) return { ok: false, message: `Crate not found: ${crateId}` };
  let stack: ItemStack;
  try {
    stack = new ItemStack(normalizeItemId(crate.keyItemId), Math.max(1, Math.floor(amount || 1)));
    stack.nameTag = `§6${crate.displayName} Key`;
    stack.setLore([crate.keyLoreLine, markerLine(crate.id)]);
  } catch {
    return { ok: false, message: `Invalid key item id for ${crate.displayName}: ${crate.keyItemId}` };
  }
  const inventory = getInventoryContainer(player);
  if (!inventory) return { ok: false, message: `Inventory unavailable while giving ${crate.displayName} key.` };
  const left = inventory.addItem(stack);
  if (left) return { ok: false, message: `Not enough inventory space for ${crate.displayName} key.` };
  return { ok: true, message: `Gave ${stack.amount} key(s) for ${crate.displayName}.` };
}

export function setCrateAtBlock(player: Player, crateId: string): { ok: boolean; message: string } {
  const crate = state.crates.crates[normalizeId(crateId)];
  if (!crate) return { ok: false, message: "Crate not found." };
  const target = player.getBlockFromViewDirection({ maxDistance: 6 });
  const block = target?.block;
  if (!block) return { ok: false, message: "Look at a block within 6 blocks." };
  if (normalizeItemId(block.typeId) !== normalizeItemId(crate.crateBlockId)) {
    return { ok: false, message: `Block must be ${crate.crateBlockId}.` };
  }
  const key = blockKey(block.dimension.id, block.location.x, block.location.y, block.location.z);
  state.crates.locations[key] = {
    crateId: crate.id,
    dimensionId: block.dimension.id,
    x: Math.floor(block.location.x),
    y: Math.floor(block.location.y),
    z: Math.floor(block.location.z),
  };
  saveCrates();
  return { ok: true, message: `Registered ${crate.displayName} at ${Math.floor(block.location.x)} ${Math.floor(block.location.y)} ${Math.floor(block.location.z)}.` };
}

export function setCrateAtCoordinates(crateId: string, dimensionId: string, x: number, y: number, z: number): { ok: boolean; message: string } {
  const crate = state.crates.crates[normalizeId(crateId)];
  if (!crate) return { ok: false, message: "Crate not found." };
  try {
    const block = world.getDimension(dimensionId).getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
    if (!block) return { ok: false, message: "No block found at that location." };
    if (normalizeItemId(block.typeId) !== normalizeItemId(crate.crateBlockId)) {
      return { ok: false, message: `Block must be ${crate.crateBlockId}.` };
    }
    const key = blockKey(dimensionId, x, y, z);
    state.crates.locations[key] = {
      crateId: crate.id,
      dimensionId,
      x: Math.floor(x),
      y: Math.floor(y),
      z: Math.floor(z),
    };
    saveCrates();
    return { ok: true, message: `Registered ${crate.displayName} at ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}.` };
  } catch {
    return { ok: false, message: "Unable to resolve that location." };
  }
}

export function removeCrateAtBlock(player: Player): { ok: boolean; message: string } {
  const target = player.getBlockFromViewDirection({ maxDistance: 6 });
  const block = target?.block;
  if (!block) return { ok: false, message: "Look at a registered crate block." };
  const key = blockKey(block.dimension.id, block.location.x, block.location.y, block.location.z);
  if (!state.crates.locations[key]) return { ok: false, message: "No crate registered at that block." };
  delete state.crates.locations[key];
  saveCrates();
  return { ok: true, message: "Crate registration removed." };
}

export function listCrateIds(): string[] {
  return Object.keys(state.crates.crates).sort((a, b) => a.localeCompare(b));
}
