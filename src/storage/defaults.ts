import { type BindingStore, type ChatConfig, type ClaimFlags, type ClaimStore, type CombatStore, type CommandBuilderStore, type ConfigStore, type CrateStore, type CustomAreaStore, type CustomRewardStore, type GeneratorStore, type HomeStore, type LootChestStore, type ModerationStore, type PayStore, type PlayerProfilesStore, type PlayerSettingsStore, type PlayerShopStore, type PlayerStats, type PlotStore, type PruneStore, type RankStore, type ReferralStore, type RtpProtection, type RtpStore, type SidebarStore, type TauItemsStore, type TeamHomeStore, type TeamStore, type TpaStore, type WarpStore } from "../types";

export function defaultConfig(): ConfigStore {
  return {
    features: {
      creator: true,
      forms: true,
      shops: true,
      sidebars: true,
      bindings: true,
      ranks: true,
      stats: true,
      profiles: true,
      plots: true,
      tpa: true,
      homes: true,
      pay: true,
      playerConfig: true,
      teams: true,
      prune: true,
      warps: true,
      plotTp: true,
      generators: true,
      crates: true,
      items: true,
      combat: true,
      moderation: true,
      customAreas: true,
      lootChests: true,
      commandBuilder: true,
      claims: true,
      rtp: true,
      teamHomes: true,
      customRewards: true,
      referrals: true,
    },
  };
}

export function defaultCustomRewardStore(): CustomRewardStore {
  return {
    config: {
      enabled: true,
      maxRewards: 100,
      maxActionsPerReward: 20,
    },
    rewards: {
      referral_bonus: {
        id: "referral_bonus",
        name: "Referral Bonus",
        description: "Default money reward for referral participants.",
        enabled: true,
        operatorOnly: true,
        actions: [{ type: "score", objective: "money", operation: "add", amount: 100 }],
      },
    },
  };
}

export function defaultReferralStore(): ReferralStore {
  return {
    config: {
      enabled: true,
      allowMultipleRedemptions: false,
      refereeRewardIds: ["referral_bonus"],
      referrerRewardIds: ["referral_bonus"],
      broadcastMessage: false,
      maxRedemptionHistory: 500,
    },
    players: {},
    codeToPlayerId: {},
    redemptions: [],
  };
}

function defaultRtpProtection(): RtpProtection {
  return {
    enabled: true,
    durationSeconds: 15,
    preventFallDamage: true,
    preventPvpDamage: true,
    preventMobDamage: true,
    preventFireDamage: true,
    resistanceEffect: true,
    slowFallingEffect: false,
  };
}

export function defaultRtpStore(): RtpStore {
  return {
    config: {
      enabled: true,
      cooldownSeconds: 60,
      maxAttempts: 32,
      allowCrossDimension: true,
      defaultFallFromSky: true,
      defaultSkyHeightOffset: 40,
      avoidClaims: true,
      avoidCustomAreas: true,
      defaultProtection: defaultRtpProtection(),
    },
    regions: {},
  };
}

function defaultClaimFlags(): ClaimFlags {
  return {
    protectionEnabled: true,
    blockBreak: false,
    blockPlace: false,
    itemUse: false,
    entityInteract: false,
    pvp: false,
    allowTeamAccess: true,
  };
}

export function defaultClaimStore(): ClaimStore {
  return {
    config: {
      enabled: true,
      protectionEnabled: true,
      allowPlayersToToggleProtection: true,
      maxClaimsPerPlayer: 3,
      maxClaimsPerTeam: 10,
      minClaimSize: { x: 5, y: 1, z: 5 },
      maxClaimSize: { x: 100, y: 100, z: 100 },
      maxClaimVolume: 262144,
      allowOverlaps: false,
      checkIntervalTicks: 10,
      defaultFlags: defaultClaimFlags(),
      playerEditableFlags: {
        protectionEnabled: true,
        blockBreak: true,
        blockPlace: true,
        itemUse: true,
        entityInteract: true,
        pvp: true,
        allowTeamAccess: true,
      },
      announcementTargets: ["player", "owner", "claim_members", "team", "global"],
    },
    claims: {},
    playerClaimIds: {},
    teamClaimIds: {},
  };
}

export function defaultCommandBuilderStore(): CommandBuilderStore {
  return {
    config: {
      enabled: true,
      maxCommands: 100,
      maxActionsPerCommand: 30,
      maxDelayTicks: 20 * 60 * 5,
    },
    commands: {},
  };
}

export function defaultLootChestStore(): LootChestStore {
  return {
    config: {
      enabled: true,
      processIntervalTicks: 20,
      maxRefillsPerTick: 4,
      defaultRespawnTicks: 20 * 60 * 10,
    },
    pools: {},
    snapshots: {},
    chests: {},
  };
}

export function defaultCombatStore(): CombatStore {
  return {
    config: {
      enabled: true,
      combatTimeSeconds: 15,
      announceLogouts: true,
      blockCommands: true,
      enterMessage: "§c» You are now in combat! Do not log out.",
      exitMessage: "§a» You are no longer in combat.",
      logoutBroadcastMessage: "§e[!] {player} quit while tagged and dropped their loot!",
      rejoinPenaltyMessage: "§4» Your items were dropped because you logged out during combat.",
      blockedCommandMessage: "§c» Commands are disabled while you are in combat.",
      killConditions: {
        enabled: true,
        rules: [],
      },
    },
  };
}

export function defaultPlayerShopStore(): PlayerShopStore {
  return {
    config: {
      enabled: true,
      defaultCurrencyObjective: "money",
      allowCustomItems: true,
      minPricePerUnit: 1,
      maxPricePerUnit: 1000000,
      taxPercent: 0,
      maxListingsPerShop: 32,
      defaultVisibility: "public",
      announceSales: true,
    },
    shops: {},
    listings: {},
    earningsByPlayerId: {},
  };
}

export function defaultTauItemsStore(): TauItemsStore {
  return {
    config: {
      enabled: true,
    },
    items: {},
  };
}

export function defaultCrateStore(): CrateStore {
  return {
    config: {
      enabled: true,
    },
    crates: {
      legendary: {
        id: "legendary",
        displayName: "Legendary Crate",
        keyItemId: "minecraft:tripwire_hook",
        keyLoreLine: "§6Legendary Key",
        crateBlockId: "minecraft:gilded_blackstone",
        animationPreset: "arcane",
        particlePreset: "arcane",
        broadcastRareWins: true,
        rareBroadcastWeightThreshold: 5,
        rewards: [
          {
            type: "item",
            label: "Diamond x16",
            weight: 100,
            itemId: "minecraft:diamond",
            amount: 16,
          },
          {
            type: "item",
            label: "Netherite Ingot x1",
            weight: 10,
            itemId: "minecraft:netherite_ingot",
            amount: 1,
          },
          {
            type: "item",
            label: "Diamond Sword",
            weight: 5,
            itemId: "minecraft:diamond_sword",
            amount: 1,
            nameTag: "§bLegend Blade",
          },
          {
            type: "score",
            label: "$1000",
            weight: 15,
            objective: "money",
            amount: 1000,
          },
          {
            type: "tag",
            label: "Legendary Winner Tag",
            weight: 1,
            tag: "tau.crate.legendary_winner",
          },
        ],
      },
    },
    locations: {},
  };
}

export function defaultGeneratorStore(): GeneratorStore {
  return {
    definitions: {},
    placed: {},
    config: {
      enabled: true,
      defaultPlaceAnywhere: true,
      blockOnPlotOnly: false,
      autoBreakersEnabled: true,
      maxTurboSpawnsPerCycle: 32,
    },
  };
}

export function defaultModerationStore(): ModerationStore {
  return {
    bannedItems: [],
    inspectionSnapshots: {},
  };
}

export function defaultCustomAreaStore(): CustomAreaStore {
  return {
    config: {
      enabled: true,
      checkIntervalTicks: 10,
      maxAreas: 250,
      maxCommandsPerArea: 10,
    },
    areas: {},
  };
}

export function defaultTeamStore(): TeamStore {
  return {
    enabled: true,
    maxMembers: 10,
    teams: {},
    playerTeamIds: {},
  };
}

export function defaultPruneStore(): PruneStore {
  return {
    config: {
      enabled: false,
      inactiveDays: 30,
      flags: {
        stats: true,
        profiles: true,
        teams: true,
        plots: true,
        claims: true,
        homes: true,
        tpa: true,
        pay: true,
        playerSettings: true,
        teamHomes: true,
      },
    },
  };
}

export function defaultWarpStore(): WarpStore {
  return {
    config: {
      enabled: true,
      maxWarps: 100,
      defaultPublic: true,
      crossDimension: true,
      cooldownSeconds: 5,
      categories: ["spawn", "pvp", "shop", "games"],
    },
    warps: {},
  };
}

export function defaultTpaStore(): TpaStore {
  return {
    config: {
      enabled: true,
      timeoutSeconds: 60,
      cooldownSeconds: 20,
    },
  };
}

export function defaultHomeStore(): HomeStore {
  return {
    config: {
      enabled: true,
      maxHomesDefault: 2,
      allowCrossDimension: false,
    },
    homesByPlayerId: {},
  };
}

export function defaultTeamHomeStore(): TeamHomeStore {
  return {
    config: {
      enabled: true,
      maxHomesPerTeam: 5,
      allowCrossDimension: false,
      blockWhileInCombat: true,
    },
    homesByTeamId: {},
  };
}

export function defaultPayStore(): PayStore {
  return {
    config: {
      enabled: true,
      currencyObjective: "money",
      minAmount: 1,
      maxAmount: 100000,
      taxPercent: 0,
      cooldownSeconds: 1,
    },
  };
}

export function defaultPlayerSettingsStore(): PlayerSettingsStore {
  return {
    config: {
      enabled: true,
      defaultAllowTpa: true,
      defaultAllowPay: true,
      defaultShowSocialMessages: true,
    },
    players: {},
  };
}

export function defaultPlotStore(): PlotStore {
  return {
    config: {
      enabled: false,
      activePlotCount: 10,
      size: { x: 20, y: 10, z: 20 },
      spacing: 4,
      dimensionId: "minecraft:overworld",
      origin: undefined,
      saveIntervalTicks: 20,
      autoBuild: {
        clearBase: true,
        addBorders: true,
        borderBlock: "stone",
        borderHeight: 1,
        floorBlock: undefined,
        roofBlock: "barrier",
        roofHeight: 3,
        showEnterTitle: false,
        titleRadius: 5,
        titleMode: "owner",
      },
    },
    slots: {},
    playerToSlot: {},
    snapshots: {},
  };
}

export function defaultPlayerStats(): PlayerStats {
  return {
    kills: 0,
    deaths: 0,
    killstreak: 0,
    longestKillstreak: 0,
    blocksPlaced: 0,
    blocksBroken: 0,
    timePlayed: 0,
    distanceTraveled: 0,
    lastSeenAt: 0,
  };
}

export function defaultChatConfig(): ChatConfig {
  return {
    enabled: true,
    template: "[name]: [rank] [message]",
  };
}

export function defaultRankStore(): RankStore {
  return {
    ranks: {
      member: {
        id: "member",
        name: "Member",
        priority: 0,
        color: "§f",
        permissions: [],
      },
    },
    playerRanks: {},
    defaultRankId: "member",
  };
}
