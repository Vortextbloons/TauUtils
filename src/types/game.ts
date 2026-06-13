import type { SerializedItemStack } from "./shop";

export type KillConditionScoreAction = {
  type: "score";
  target: "killer" | "victim";
  objective: string;
  operation: "add" | "set" | "remove";
  amount: number;
};

export type KillConditionCommandAction = {
  type: "command";
  commands: string[];
};

export type KillConditionAction = KillConditionScoreAction | KillConditionCommandAction;

export type KillConditionFilters = {
  requireKillerRankMatch: boolean;
  killerRanks: string[];
  requireVictimRankMatch: boolean;
  victimRanks: string[];
  minKillerKillstreak?: number;
  maxKillerKillstreak?: number;
  minKillerKills?: number;
};

export type KillConditionRule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  filters: KillConditionFilters;
  actions: KillConditionAction[];
};

export type KillConditionStore = {
  enabled: boolean;
  rules: KillConditionRule[];
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
  killConditions: KillConditionStore;
};

export type CombatStore = {
  config: CombatConfig;
};

export type BuiltCommandCondition =
  | {
      type: "rank";
      mode: "allow" | "deny";
      ranks: string[];
    }
  | {
      type: "tag";
      mode: "has" | "missing";
      tag: string;
    }
  | {
      type: "score";
      objective: string;
      operator: "==" | "!=" | ">=" | "<=" | ">" | "<";
      value: number;
    }
  | {
      type: "permission";
      permission: string;
    };

export type BuiltCommandAction =
  | {
      type: "command";
      command: string;
      delayTicks?: number;
      runAs?: "executor" | "world";
    }
  | {
      type: "effect";
      effectId: string;
      durationSeconds: number;
      amplifier: number;
      showParticles?: boolean;
      delayTicks?: number;
    }
  | {
      type: "score";
      objective: string;
      operation: "add" | "set" | "remove";
      amount: number;
      delayTicks?: number;
    }
  | {
      type: "tag";
      operation: "add" | "remove";
      tag: string;
      delayTicks?: number;
    }
  | {
      type: "message";
      message: string;
      delayTicks?: number;
    };

export type BuiltCommandDefinition = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  adminOnly: true;
  cooldownSeconds?: number;
  conditions: BuiltCommandCondition[];
  actions: BuiltCommandAction[];
};

export type CommandBuilderStore = {
  config: {
    enabled: boolean;
    maxCommands: number;
    maxActionsPerCommand: number;
    maxDelayTicks: number;
  };
  commands: Record<string, BuiltCommandDefinition>;
};

export type CustomRewardAction =
  | { type: "score"; objective: string; operation: "add" | "set" | "remove"; amount: number }
  | { type: "item"; itemId: string; amount: number }
  | { type: "item_stack"; item: SerializedItemStack }
  | { type: "command"; command: string; runAs?: "player" | "world" }
  | { type: "tag"; operation: "add" | "remove"; tag: string }
  | { type: "effect"; effectId: string; durationSeconds: number; amplifier: number; showParticles?: boolean }
  | { type: "message"; message: string };

export type CustomRewardDefinition = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  operatorOnly: boolean;
  permission?: string;
  actions: CustomRewardAction[];
};

export type CustomRewardStore = {
  config: {
    enabled: boolean;
    maxRewards: number;
    maxActionsPerReward: number;
  };
  rewards: Record<string, CustomRewardDefinition>;
};

export type ReferralPlayerRecord = {
  code: string;
  redeemedCodes: string[];
  referredByPlayerIds: string[];
  referralCount: number;
  pendingRewardIds: string[];
  lastKnownName: string;
};

export type ReferralRedemption = {
  refereePlayerId: string;
  refereeName: string;
  referrerPlayerId: string;
  referrerName: string;
  code: string;
  redeemedAt: number;
};

export type ReferralStore = {
  config: {
    enabled: boolean;
    allowMultipleRedemptions: boolean;
    refereeRewardIds: string[];
    referrerRewardIds: string[];
    broadcastMessage: boolean;
    maxRedemptionHistory: number;
  };
  players: Record<string, ReferralPlayerRecord>;
  codeToPlayerId: Record<string, string>;
  redemptions: ReferralRedemption[];
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

export type LootChestRefillMode = "open" | "always" | "empty_only";

export type LootChestSnapshotItem = {
  slot: number;
  item: SerializedItemStack;
};

export type LootChestSnapshot = {
  id: string;
  poolId: string;
  name: string;
  weight: number;
  enabled: boolean;
  containerSize: number;
  capturedAt: number;
  source?: {
    dimensionId: string;
    x: number;
    y: number;
    z: number;
  };
  items: LootChestSnapshotItem[];
};

export type LootChestPool = {
  id: string;
  name: string;
  enabled: boolean;
  snapshotIds: string[];
};

export type LootChestLocation = {
  id: string;
  name: string;
  poolId: string;
  dimensionId: string;
  x: number;
  y: number;
  z: number;
  enabled: boolean;
  respawnTicks: number;
  nextRefillAt: number;
  emptySinceAt?: number;
  refillMode: LootChestRefillMode;
  preserveSlots: boolean;
  refillMessageEnabled?: boolean;
  refillMessage?: string;
  broadcastRefillMessage?: boolean;
  refillCommandsEnabled?: boolean;
  refillCommands?: string[];
};

export type LootChestConfig = {
  enabled: boolean;
  processIntervalTicks: number;
  maxRefillsPerTick: number;
  defaultRespawnTicks: number;
};

export type LootChestStore = {
  config: LootChestConfig;
  pools: Record<string, LootChestPool>;
  snapshots: Record<string, LootChestSnapshot>;
  chests: Record<string, LootChestLocation>;
};

export type GeneratorTierDefinition = {
  tier: number;
  rateTicks: number;
  upgradeCost: number;
};

export type GeneratorKind = "fixed" | "weighted";

export type GeneratorOutputEntry = {
  itemId: string;
  weight: number;
};

export type GeneratorDefinition = {
  id: string;
  name: string;
  kind: GeneratorKind;
  baseItemId: string;
  outputItemId: string;
  outputPool?: GeneratorOutputEntry[];
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
  /** When true, only operators can place, upgrade, pickup, or change autobreaker; others can view info only. */
  adminProtected?: boolean;
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
  originalBaseBlockId?: string;
  originalOutputBlockId?: string;
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
    maxTurboSpawnsPerCycle: number;
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

export type CustomAreaVector = { x: number; y: number; z: number };

export type CustomAreaPermissions = {
  pvp: boolean;
  blockBreak: boolean;
  blockBreakExceptions: string[];
  blockPlace: boolean;
  blockPlaceExceptions: string[];
  itemUse: boolean;
  entityInteract: boolean;
  teleport: boolean;
};

export type CustomAreaEffect = {
  enabled: boolean;
  effectId: string;
  amplifier: number;
  durationSeconds: number;
  hideParticles: boolean;
  intervalTicks: number;
};

export type CustomAreaCommandRule = {
  enabled: boolean;
  commands: string[];
  intervalTicks: number;
  runOnEnter: boolean;
  runOnLeave: boolean;
  runWhileInside: boolean;
};

export type CustomAreaTickingArea = {
  enabled: boolean;
  name: string;
};

export type CustomAreaDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  dimensionId: string;
  min: CustomAreaVector;
  max: CustomAreaVector;
  priority: number;
  enterMessage?: string;
  leaveMessage?: string;
  broadcastMessages: boolean;
  allowedRanks: string[];
  dropItemsIfInCombat: boolean;
  permissions: CustomAreaPermissions;
  effects: CustomAreaEffect[];
  commandRules: CustomAreaCommandRule[];
  tickingArea?: CustomAreaTickingArea;
};

export type CustomAreaStore = {
  config: {
    enabled: boolean;
    checkIntervalTicks: number;
    maxAreas: number;
    maxCommandsPerArea: number;
  };
  areas: Record<string, CustomAreaDefinition>;
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
  claims: boolean;
  homes: boolean;
  tpa: boolean;
  pay: boolean;
  playerSettings: boolean;
  teamHomes: boolean;
};

export type PruneConfig = {
  enabled: boolean;
  inactiveDays: number;
  flags: PruneFlags;
};

export type PruneStore = {
  config: PruneConfig;
};
