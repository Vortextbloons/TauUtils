export const STORAGE_KEYS = {
  forms: "tau:forms",
  shops: "tau:shops",
  binds: "tau:binds",
  sidebars: "tau:sidebars",
  config: "tau:config",
  combat: "tau:combat",
  ranks: "tau:ranks",
  chat: "tau:chat",
  plots: "tau:plots",
  tpa: "tau:tpa",
  homes: "tau:homes",
  pay: "tau:pay",
  playerSettings: "tau:player_settings",
  teams: "tau:teams",
  warps: "tau:warps",
  generators: "tau:generators",
  moderation: "tau:moderation",
  crates: "tau:crates",
  tauItems: "tau:items",
  playerShops: "tau:player_shops",
} as const;

export const CHAT_PREFIX = "§6[TauUI]§r";

export const RANK_COLORS = [
  "Black", "Dark Blue", "Dark Green", "Dark Aqua", "Dark Red", "Dark Purple",
  "Gold", "Gray", "Dark Gray", "Blue", "Green", "Aqua", "Red", "Light Purple",
  "Yellow", "White",
] as const;

export const RANK_COLOR_CODES: Record<string, string> = {
  "Black": "§0", "Dark Blue": "§1", "Dark Green": "§2", "Dark Aqua": "§3",
  "Dark Red": "§4", "Dark Purple": "§5", "Gold": "§6", "Gray": "§7",
  "Dark Gray": "§8", "Blue": "§9", "Green": "§a", "Aqua": "§b",
  "Red": "§c", "Light Purple": "§d", "Yellow": "§e", "White": "§f",
};

export const CODE_TO_COLOR_NAME: Record<string, string> = {
  "§0": "Black", "§1": "Dark Blue", "§2": "Dark Green", "§3": "Dark Aqua",
  "§4": "Dark Red", "§5": "Dark Purple", "§6": "Gold", "§7": "Gray",
  "§8": "Dark Gray", "§9": "Blue", "§a": "Green", "§b": "Aqua",
  "§c": "Red", "§d": "Light Purple", "§e": "Yellow", "§f": "White",
};

export const CHAT_TEMPLATE_PLACEHOLDERS = [
  "[name]",
  "[rank]",
  "[rank_prefix]",
  "[rank_suffix]",
  "[team]",
  "[money]",
  "[message]",
] as const;

export { ICONS, WORKING_ICON_OPTIONS, ICON_DEV_OPTIONS, WORKING_ICON_PATHS, isWorkingIconPath } from "./icons";
export type { IconOption } from "./icons";

export const ACTION_TYPES = [
  "COMMAND_PLAYER",
  "COMMAND_SUDO",
  "OPEN_MENU",
  "CLOSE",
  "SHOP_TRANSACTION",
] as const;

export const RESTRICTED_PLAYER_COMMANDS = new Set([
  "op",
  "deop",
  "stop",
  "reload",
  "whitelist",
  "permissions",
  "ban",
  "kick",
]);

export type ActionType = (typeof ACTION_TYPES)[number];
export type FormLayout = "action" | "modal";

export type UIButtonElement = {
  kind: "button";
  text: string;
  iconPath?: string;
  action: ActionType;
  value?: string;
};

export type UIToggleElement = {
  kind: "toggle";
  label: string;
  defaultValue?: boolean;
  action: ActionType;
  value?: string;
};

export type UISliderElement = {
  kind: "slider";
  label: string;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  action: ActionType;
  value?: string;
};

export type UIDropdownElement = {
  kind: "dropdown";
  label: string;
  options: string[];
  defaultValueIndex?: number;
  action: ActionType;
  value?: string;
};

export type UIInputElement = {
  kind: "input";
  label: string;
  placeholder?: string;
  defaultValue?: string;
  action: ActionType;
  value?: string;
};

export type UILabelElement = {
  kind: "label";
  text: string;
};

export type UIDividerElement = {
  kind: "divider";
};

export type FormElement =
  | UIButtonElement
  | UIToggleElement
  | UISliderElement
  | UIDropdownElement
  | UIInputElement
  | UILabelElement
  | UIDividerElement;

export type FormDefinition = {
  id: string;
  title: string;
  body?: string;
  layout: FormLayout;
  elements: FormElement[];
};

export type ShopSortMode = "default" | "name" | "buyPrice" | "sellPrice" | "category";

export type ShopItemDefinition = {
  id?: string;
  itemId: string;
  label?: string;
  displayName?: string;
  category?: string;
  buyPrice: number;
  sellPrice: number;
  canBuy?: boolean;
  canSell?: boolean;
  quantities: number[];
  lore?: string[];
  enchantments?: { id: string; level: number }[];
  bundle?: ShopItemStackDefinition[];
  durability?: number;
  maxDurability?: number;
  exactDurability?: boolean;
  customData?: string;
  showEnchantsInPreview?: boolean;
};

export type ShopProfile = {
  id: string;
  currencyObjective: string;
  categories?: string[];
  items: ShopItemDefinition[];
  kitDraft?: ShopKitDraft;
  sortMode?: ShopSortMode;
};

export type ShopItemStackDefinition = {
  itemId: string;
  amount: number;
  label?: string;
  displayName?: string;
  lore?: string[];
  enchantments?: { id: string; level: number }[];
  durability?: number;
  maxDurability?: number;
  exactDurability?: boolean;
  customData?: string;
};

export type ShopKitDraft = {
  sourceItemId?: string;
  displayName: string;
  category: string;
  buyPrice: number;
  quantities: number[];
  bundle: ShopItemStackDefinition[];
};

export type SerializedVector3 = {
  x: number;
  y: number;
  z: number;
};

export type SerializedDynamicValue = boolean | number | string | SerializedVector3;

export type SerializedItemStack = {
  itemId: string;
  amount: number;
  nameTag?: string;
  lore?: string[];
  enchantments?: { id: string; level: number }[];
  durability?: number;
  maxDurability?: number;
  canDestroy?: string[];
  canPlaceOn?: string[];
  dynamicProperties?: Record<string, SerializedDynamicValue>;
  lockMode?: string;
  keepOnDeath?: boolean;
};

export type PlayerShopVisibility = "public" | "private";

export type PlayerShopConfig = {
  enabled: boolean;
  defaultCurrencyObjective: string;
  allowCustomItems: boolean;
  minPricePerUnit: number;
  maxPricePerUnit: number;
  taxPercent: number;
  maxListingsPerShop: number;
  defaultVisibility: PlayerShopVisibility;
  announceSales: boolean;
};

export type PlayerShop = {
  id: string;
  ownerPlayerId: string;
  ownerName: string;
  title: string;
  description?: string;
  visibility: PlayerShopVisibility;
  currencyObjective: string;
  listingIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type PlayerShopListing = {
  id: string;
  shopId: string;
  sellerPlayerId: string;
  sellerName: string;
  title: string;
  category?: string;
  item: SerializedItemStack;
  quantity: number;
  pricePerUnit: number;
  currencyObjective: string;
  createdAt: number;
  updatedAt: number;
};

export type PlayerShopStore = {
  config: PlayerShopConfig;
  shops: Record<string, PlayerShop>;
  listings: Record<string, PlayerShopListing>;
  earningsByPlayerId: Record<string, Record<string, number>>;
};

export type BindingStore = {
  itemBinds: Record<string, string>;
  entityTagBinds: Record<string, string>;
};

export type SidebarDefinition = {
  id: string;
  title: string;
  updateInterval: number;
  priority: number;
  enabled: boolean;
  moneyObjective?: string;
  lines: string[];
  scroll?: boolean;
};

export type SidebarStore = {
  enabled: boolean;
  defaultSidebarId?: string;
  sidebars: Record<string, SidebarDefinition>;
};

export type FeatureFlags = {
  creator: boolean;
  forms: boolean;
  shops: boolean;
  sidebars: boolean;
  bindings: boolean;
  ranks: boolean;
  stats: boolean;
  profiles: boolean;
  plots: boolean;
  tpa: boolean;
  homes: boolean;
  pay: boolean;
  playerConfig: boolean;
  teams: boolean;
  prune: boolean;
  warps: boolean;
  plotTp: boolean;
  generators: boolean;
  crates: boolean;
  items: boolean;
  combat: boolean;
};

export type CombatConfig = {
  enabled: boolean;
  combatTimeSeconds: number;
  announceLogouts: boolean;
  blockCommands: boolean;
  enterMessage: string;
  exitMessage: string;
  logoutBroadcastMessage: string;
  rejoinPenaltyMessage: string;
  blockedCommandMessage: string;
};

export type CombatStore = {
  config: CombatConfig;
};

export type TauItemTriggerType = "use_air" | "use_block" | "hit_melee" | "mine_block";
export type TauItemConsumptionMode = "none" | "consume_item" | "damage_durability";
export type TauItemCostType = "money" | "xp" | "health";

export type TauItemCost = {
  type: TauItemCostType;
  amount: number;
  objective?: string;
};

export type TauItemCommandAction = {
  type: "command";
  commands: string[];
};

export type TauItemSoundAction = {
  type: "sound";
  soundId: string;
  volume?: number;
  pitch?: number;
};

export type TauItemParticleAction = {
  type: "particle";
  particleId: string;
  count?: number;
  spread?: number;
};

export type TauItemEffectAction = {
  type: "effect";
  effectId: string;
  durationTicks: number;
  amplifier?: number;
};

export type TauItemProjectileAction = {
  type: "projectile";
  entityId: string;
  speed?: number;
};

export type TauItemAoeAction = {
  type: "aoe";
  radius: number;
  mode: "damage" | "heal" | "knockback";
  amount: number;
};

export type TauItemAction =
  | TauItemCommandAction
  | TauItemSoundAction
  | TauItemParticleAction
  | TauItemEffectAction
  | TauItemProjectileAction
  | TauItemAoeAction;

export type TauItemDefinition = {
  id: string;
  displayName: string;
  baseItemId: string;
  loreDescription?: string;
  triggers: TauItemTriggerType[];
  actions: TauItemAction[];
  cooldownSeconds: number;
  consumption: TauItemConsumptionMode;
  maxUses?: number;
  requiredTag?: string;
  cost?: TauItemCost;
  cancelVanilla?: boolean;
};

export type TauItemsStore = {
  config: {
    enabled: boolean;
  };
  items: Record<string, TauItemDefinition>;
};

export type CrateLocation = {
  dimensionId: string;
  x: number;
  y: number;
  z: number;
};

export type CrateItemReward = {
  type: "item";
  label: string;
  weight: number;
  itemId: string;
  amount: number;
  displayName?: string;
  lore?: string[];
  enchantments?: { id: string; level: number }[];
  durability?: number;
  maxDurability?: number;
  canPlaceOn?: string[];
  canDestroy?: string[];
  customData?: string;
  nameTag?: string;
};

export type CrateCommandReward = {
  type: "command";
  label: string;
  weight: number;
  command: string;
};

export type CrateScoreReward = {
  type: "score";
  label: string;
  weight: number;
  objective: string;
  amount: number;
};

export type CrateTagReward = {
  type: "tag";
  label: string;
  weight: number;
  tag: string;
};

export type CrateReward =
  | CrateItemReward
  | CrateCommandReward
  | CrateScoreReward
  | CrateTagReward;

export type CrateDefinition = {
  id: string;
  displayName: string;
  keyItemId: string;
  keyLoreLine: string;
  crateBlockId: string;
  animationPreset: CrateAnimationPreset;
  particlePreset: CrateParticlePreset;
  broadcastRareWins: boolean;
  rareBroadcastWeightThreshold: number;
  rewards: CrateReward[];
};

export type CrateAnimationPreset = "arcane" | "ember" | "frost" | "void";
export type CrateParticlePreset = "arcane" | "ember" | "frost" | "void";

export type CrateStore = {
  config: {
    enabled: boolean;
  };
  crates: Record<string, CrateDefinition>;
  locations: Record<string, { crateId: string; dimensionId: string; x: number; y: number; z: number }>;
};

export type GeneratorTierDefinition = {
  tier: number;
  rateTicks: number;
  upgradeCost: number;
};

export type GeneratorDefinition = {
  id: string;
  name: string;
  baseItemId: string;
  outputItemId: string;
  displayName?: string;
  icon?: string;
  lore?: string[];
  customData?: string;
  enchantments?: { id: string; level: number }[];
  durability?: number;
  maxDurability?: number;
  canPlaceOn?: string[];
  canDestroy?: string[];
  tiers: GeneratorTierDefinition[];
  placeAnywhere: boolean;
  autoBreakerCost?: number;
};

export type PlacedGenerator = {
  id: string;
  definitionId: string;
  ownerPlayerId: string;
  dimensionId: string;
  x: number;
  y: number;
  z: number;
  tier: number;
  nextSpawnAt: number;
  autoBreakerPurchased?: boolean;
  autoBreakerEnabled?: boolean;
};

export type GeneratorStore = {
  definitions: Record<string, GeneratorDefinition>;
  placed: Record<string, PlacedGenerator>;
  config: {
    enabled: boolean;
    defaultPlaceAnywhere: boolean;
    blockOnPlotOnly: boolean;
    autoBreakersEnabled: boolean;
  };
};

export type BannedItemDefinition = {
  itemId: string;
  label?: string;
  clearHeld: boolean;
  clearInventory: boolean;
  note?: string;
};

export type ModerationItemSnapshot = {
  slot: number;
  itemId: string;
  amount: number;
  nameTag?: string;
  lore?: string[];
};

export type ModerationInspectionSnapshot = {
  playerName: string;
  updatedAt: number;
  inventory: ModerationItemSnapshot[];
  enderChest: ModerationItemSnapshot[];
};

export type ModerationStore = {
  bannedItems: BannedItemDefinition[];
  inspectionSnapshots: Record<string, ModerationInspectionSnapshot>;
};

export type GeneratorConfig = GeneratorStore["config"];

export type TeamDefinition = {
  id: string;
  name: string;
  tag: string;
  color: string;
  ownerPlayerId: string;
  memberPlayerIds: string[];
  invitedPlayerIds: string[];
  createdAt: number;
  description?: string;
  inviteOnly: boolean;
  friendlyFire: boolean;
  teamPlotEnabled: boolean;
  personalPlotSlotIds?: Record<string, string>;
};

export type WarpDefinition = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  category: string;
  dimensionId: string;
  position: { x: number; y: number; z: number };
  public: boolean;
  allowedRanks: string[];
  cooldownSeconds: number;
};

export type WarpConfig = {
  enabled: boolean;
  maxWarps: number;
  defaultPublic: boolean;
  crossDimension: boolean;
  cooldownSeconds: number;
  categories: string[];
};

export type WarpStore = {
  config: WarpConfig;
  warps: Record<string, WarpDefinition>;
};

export type TeamStore = {
  enabled: boolean;
  maxMembers: number;
  teams: Record<string, TeamDefinition>;
  playerTeamIds: Record<string, string>;
};

export type TpaConfig = {
  enabled: boolean;
  timeoutSeconds: number;
  cooldownSeconds: number;
};

export type TpaStore = {
  config: TpaConfig;
};

export type HomeLocation = {
  x: number;
  y: number;
  z: number;
  dimensionId: string;
};

export type HomeConfig = {
  enabled: boolean;
  maxHomesDefault: number;
  allowCrossDimension: boolean;
};

export type HomeStore = {
  config: HomeConfig;
  homesByPlayerId: Record<string, Record<string, HomeLocation>>;
};

export type PayConfig = {
  enabled: boolean;
  currencyObjective: string;
  minAmount: number;
  maxAmount: number;
  taxPercent: number;
  cooldownSeconds: number;
};

export type PayStore = {
  config: PayConfig;
};

export type PlayerSettings = {
  allowTpa: boolean;
  allowPay: boolean;
  showSocialMessages: boolean;
};

export type PlayerSettingsConfig = {
  enabled: boolean;
  defaultAllowTpa: boolean;
  defaultAllowPay: boolean;
  defaultShowSocialMessages: boolean;
};

export type PlayerSettingsStore = {
  config: PlayerSettingsConfig;
  players: Record<string, PlayerSettings>;
};

export type PlotVector = {
  x: number;
  y: number;
  z: number;
};

export type PlotSize = {
  x: number;
  y: number;
  z: number;
};

export type PlotSlot = {
  id: string;
  min: PlotVector;
  max: PlotVector;
  manual: boolean;
  occupiedByPlayerId?: string;
};

export type PlotConfig = {
  enabled: boolean;
  activePlotCount: number;
  size: PlotSize;
  spacing: number;
  dimensionId: string;
  origin?: PlotVector;
  saveIntervalTicks: number;
  autoBuild: {
    clearBase: boolean;
    addBorders: boolean;
    borderBlock: string;
    borderHeight: number;
    floorBlock?: string;
    roofBlock: string;
    roofHeight: number;
    showEnterTitle: boolean;
    titleRadius: number;
    titleMode: "owner" | "plot";
  };
};

export type PlotSnapshot = {
  slotId?: string;
  structureId: string;
  savedAt: number;
  sourceMin?: PlotVector;
  generators?: Array<
    {
      definitionId: string;
      ownerPlayerId: string;
      dx: number;
      dy: number;
      dz: number;
      tier: number;
      nextSpawnAt: number;
    }
    | PlacedGenerator
  >;
};

export type PlotStore = {
  config: PlotConfig;
  slots: Record<string, PlotSlot>;
  playerToSlot: Record<string, string>;
  snapshots: Record<string, PlotSnapshot>;
};

export type ConfigStore = {
  features: FeatureFlags;
};

export type PruneFlags = {
  stats: boolean;
  profiles: boolean;
  teams: boolean;
  plots: boolean;
  homes: boolean;
  tpa: boolean;
  pay: boolean;
  playerSettings: boolean;
};

export type PruneConfig = {
  enabled: boolean;
  inactiveDays: number;
  flags: PruneFlags;
};

export type PruneStore = {
  config: PruneConfig;
};

export type PlayerStats = {
  kills: number;
  deaths: number;
  killstreak: number;
  longestKillstreak: number;
  blocksPlaced: number;
  blocksBroken: number;
  timePlayed: number;
  distanceTraveled: number;
  lastSeenAt: number;
};

export type StatsStore = {
  playerIds: Record<string, string>;
  players: Record<string, PlayerStats>;
};

export type PlayerProfileSection = "summary" | "stats" | "rank" | "shop" | "custom";

export type PlayerProfileConfig = {
  enabled: boolean;
  sections: PlayerProfileSection[];
  customFields: string[];
};

export type PlayerProfilesStore = {
  configs: Record<string, PlayerProfileConfig>;
};

export type RankDefinition = {
  id: string;
  name: string;
  priority: number;
  color: string;
  prefix?: string;
  suffix?: string;
  permissions: string[];
  chatFormat?: string;
};

export type RankStore = {
  ranks: Record<string, RankDefinition>;
  playerRanks: Record<string, string>;
  defaultRankId?: string;
};

export type ChatConfig = {
  enabled: boolean;
  template: string;
};
