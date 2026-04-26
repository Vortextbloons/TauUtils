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

export type CrateAnimationPreset = "arcane" | "ember" | "frost" | "void";
export type CrateParticlePreset = "arcane" | "ember" | "frost" | "void";

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

export type GeneratorConfig = GeneratorStore["config"];

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
