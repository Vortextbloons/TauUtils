import {
  Entity,
  EntityComponentTypes,
  Player,
  PlayerPermissionLevel,
  world,
} from "@minecraft/server";
import {
  CHAT_PREFIX,
  RESTRICTED_PLAYER_COMMANDS,
  STORAGE_KEYS,
  type ConfigStore,
  type FormDefinition,
  type ShopProfile,
} from "../types";
import {
  state,
  defaultConfig,
  defaultRankStore,
  defaultChatConfig,
  defaultPlayerStats,
  defaultPlotStore,
  defaultTpaStore,
  defaultHomeStore,
  defaultPayStore,
  defaultPlayerSettingsStore,
  defaultTeamStore,
  defaultPruneStore,
  defaultWarpStore,
  defaultGeneratorStore,
  defaultModerationStore,
  defaultCrateStore,
  defaultTauItemsStore,
  defaultCombatStore,
  defaultCommandBuilderStore,
  defaultPlayerShopStore,
  PLOTS_CONFIG_KEY,
  PLOTS_MIGRATION_MARKER_KEY,
  PLOTS_SLOT_PREFIX,
  PLOTS_PLAYER_SLOT_PREFIX,
  PLOTS_SNAPSHOT_PREFIX,
  PLAYER_SHOPS_CONFIG_KEY,
  PLAYER_SHOPS_SHOP_PREFIX,
  PLAYER_SHOPS_LISTING_PREFIX,
  PLAYER_SHOPS_EARNINGS_PREFIX,
  STATS_PLAYER_IDS_KEY,
  STATS_PLAYER_PREFIX,
} from "./state";

export function tell(player: Player, message: string) {
  player.sendMessage(`${CHAT_PREFIX} ${message}`);
}

export function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function findForm(menuId: string): FormDefinition | undefined {
  return (
    state.forms[menuId] ??
    Object.values(state.forms).find(
      (form) => normalizeKey(form.id) === normalizeKey(menuId)
    )
  );
}

export function findShopProfile(profileId: string): ShopProfile | undefined {
  return (
    state.shops[profileId] ??
    Object.values(state.shops).find(
      (profile) => normalizeKey(profile.id) === normalizeKey(profileId)
    )
  );
}

export function canonicalShopId(profileId: string): string {
  return findShopProfile(profileId)?.id ?? profileId;
}

export function normalizeCategory(category?: string): string {
  return (category ?? "Uncategorized").trim() || "Uncategorized";
}

export function getOrCreateShopProfileCategoryList(profileId: string): string[] {
  const profile = findShopProfile(profileId);
  if (!profile) return [];
  profile.categories ??= [];
  return profile.categories;
}

export function getProfileCategories(profileId: string): string[] {
  return getOrCreateShopProfileCategoryList(profileId);
}

export function getInventoryContainer(player: Player) {
  const inv = player.getComponent(EntityComponentTypes.Inventory);
  if (!inv) return undefined;
  return inv.container;
}

export function countItemInContainer(player: Player, typeId: string): number {
  const container = getInventoryContainer(player);
  if (!container) return 0;
  let count = 0;
  for (let i = 0; i < container.size; i++) {
    const stack = container.getItem(i);
    if (!stack || stack.typeId !== typeId) continue;
    count += stack.amount;
  }
  return count;
}

export function removeItemFromContainer(
  player: Player,
  typeId: string,
  amount: number
): boolean {
  const container = getInventoryContainer(player);
  if (!container) return false;
  let remaining = amount;
  for (let i = 0; i < container.size && remaining > 0; i++) {
    const stack = container.getItem(i);
    if (!stack || stack.typeId !== typeId) continue;
    if (stack.amount <= remaining) {
      remaining -= stack.amount;
      container.setItem(i, undefined);
    } else {
      stack.amount -= remaining;
      remaining = 0;
      container.setItem(i, stack);
    }
  }
  return remaining === 0;
}

export function getScore(
  player: Player,
  objectiveId: string
): number | undefined {
  const objective = world.scoreboard.getObjective(objectiveId);
  if (!objective) return undefined;
  const identity = player.scoreboardIdentity;
  if (!identity) return 0;
  try {
    return objective.getScore(identity) ?? 0;
  } catch {
    return 0;
  }
}

export function setScore(
  player: Player,
  objectiveId: string,
  value: number
): boolean {
  const objective = world.scoreboard.getObjective(objectiveId);
  if (!objective) return false;
  const identity = player.scoreboardIdentity;
  if (!identity) return false;
  objective.setScore(identity, value);
  return true;
}

export function applyTemplate(
  raw: string | undefined,
  player: Player,
  selectedValue?: unknown
): string {
  if (!raw) return "";
  return raw
    .split("{player}")
    .join(player.name)
    .split("{value}")
    .join(selectedValue === undefined ? "" : String(selectedValue));
}

export function normalizeItemId(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isFeatureEnabled(feature: keyof ConfigStore["features"]) {
  return state.config.features[feature] !== false;
}

export function clearAllData() {
  world.setDynamicProperty(STORAGE_KEYS.forms, undefined);
  world.setDynamicProperty(STORAGE_KEYS.shops, undefined);
  world.setDynamicProperty(STORAGE_KEYS.binds, undefined);
  world.setDynamicProperty(STORAGE_KEYS.sidebars, undefined);
  world.setDynamicProperty(STORAGE_KEYS.config, undefined);
  world.setDynamicProperty(STORAGE_KEYS.ranks, undefined);
  world.setDynamicProperty(STORAGE_KEYS.chat, undefined);
  world.setDynamicProperty("tau:stats", undefined);
  world.setDynamicProperty("tau:profiles", undefined);
  world.setDynamicProperty(STORAGE_KEYS.plots, undefined);
  world.setDynamicProperty(STORAGE_KEYS.tpa, undefined);
  world.setDynamicProperty(STORAGE_KEYS.homes, undefined);
  world.setDynamicProperty(STORAGE_KEYS.pay, undefined);
  world.setDynamicProperty(STORAGE_KEYS.playerSettings, undefined);
  world.setDynamicProperty(STORAGE_KEYS.teams, undefined);
  world.setDynamicProperty("tau:prune", undefined);
  world.setDynamicProperty(STORAGE_KEYS.warps, undefined);
  world.setDynamicProperty(STORAGE_KEYS.generators, undefined);
  world.setDynamicProperty(STORAGE_KEYS.moderation, undefined);
  world.setDynamicProperty(STORAGE_KEYS.crates, undefined);
  world.setDynamicProperty(STORAGE_KEYS.tauItems, undefined);
  world.setDynamicProperty(STORAGE_KEYS.combat, undefined);
  world.setDynamicProperty(STORAGE_KEYS.commandBuilder, undefined);
  world.setDynamicProperty(STORAGE_KEYS.playerShops, undefined);
  world.setDynamicProperty(PLAYER_SHOPS_CONFIG_KEY, undefined);
  world.setDynamicProperty(PLOTS_CONFIG_KEY, undefined);
  world.setDynamicProperty(PLOTS_MIGRATION_MARKER_KEY, undefined);
  for (const key of world.getDynamicPropertyIds()) {
    if (
      key.startsWith(STATS_PLAYER_PREFIX) ||
      key === STATS_PLAYER_IDS_KEY ||
      key.startsWith(PLOTS_SLOT_PREFIX) ||
      key.startsWith(PLOTS_PLAYER_SLOT_PREFIX) ||
      key.startsWith(PLOTS_SNAPSHOT_PREFIX) ||
      key.startsWith(PLAYER_SHOPS_SHOP_PREFIX) ||
      key.startsWith(PLAYER_SHOPS_LISTING_PREFIX) ||
      key.startsWith(PLAYER_SHOPS_EARNINGS_PREFIX)
    ) {
      world.setDynamicProperty(key, undefined);
    }
  }
  state.forms = {};
  state.shops = {};
  state.binds = { itemBinds: {}, entityTagBinds: {} };
  state.sidebars = { enabled: true, sidebars: {} };
  state.config = defaultConfig();
  state.ranks = defaultRankStore();
  state.chat = defaultChatConfig();
  state.stats = { playerIds: {}, players: {} };
  state.profiles = { configs: {} };
  state.plots = defaultPlotStore();
  state.tpa = defaultTpaStore();
  state.homes = defaultHomeStore();
  state.pay = defaultPayStore();
  state.playerSettings = defaultPlayerSettingsStore();
  state.teams = defaultTeamStore();
  state.prune = defaultPruneStore();
  state.warps = defaultWarpStore();
  state.generators = defaultGeneratorStore();
  state.moderation = defaultModerationStore();
  state.crates = defaultCrateStore();
  state.tauItems = defaultTauItemsStore();
  state.combat = defaultCombatStore();
  state.commandBuilder = defaultCommandBuilderStore();
  state.playerShops = defaultPlayerShopStore();
}

export function asPlayer(entity?: Entity): Player | undefined {
  if (!entity || entity.typeId !== "minecraft:player") return undefined;
  return entity as Player;
}

export function isOperator(player: Player): boolean {
  return player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
}

export function sanitizePlayerCommand(command: string): boolean {
  const token = command
    .replace(/^\//, "")
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase();
  if (!token) return false;
  return !RESTRICTED_PLAYER_COMMANDS.has(token);
}

export function commandStripSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

export function normalizeForSudo(command: string, player: Player): string {
  const safeName = player.name.replace(/"/g, '\\"');
  return command.replace(/@s/g, `@a[name="${safeName}"]`);
}

export function commandOriginToPlayer(
  origin: { sourceEntity?: Entity; initiator?: Entity }
): Player | undefined {
  return asPlayer(origin.sourceEntity) ?? asPlayer(origin.initiator);
}

export function getMenuIdFromTags(tags: string[]): string | undefined {
  for (const tag of tags) {
    const menuIdPrefix = /^menuid:(.+)$/i.exec(tag);
    if (menuIdPrefix) return menuIdPrefix[1].trim();
    const menuIdEqual = /^menuid=(.+)$/i.exec(tag);
    if (menuIdEqual) return menuIdEqual[1].trim();
    const menuPrefix = /^menu:(.+)$/i.exec(tag);
    if (menuPrefix) return menuPrefix[1].trim();
  }
  return undefined;
}

export function getMenuIdFromNameTag(nameTag?: string): string | undefined {
  if (!nameTag) return undefined;
  const trimmed = nameTag.trim();
  if (trimmed.toLowerCase().startsWith("menuid:")) {
    return trimmed.slice(7).trim();
  }
  if (trimmed.toLowerCase().startsWith("menu:")) {
    return trimmed.slice(5).trim();
  }
  return undefined;
}
