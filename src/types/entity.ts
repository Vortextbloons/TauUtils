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
  adminPlayerIds?: string[];
};

export type TeamStore = {
  enabled: boolean;
  maxMembers: number;
  teams: Record<string, TeamDefinition>;
  playerTeamIds: Record<string, string>;
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

export type TpaConfig = {
  enabled: boolean;
  timeoutSeconds: number;
  cooldownSeconds: number;
  notifyViaModal: boolean;
};

export type TpaStore = {
  config: TpaConfig;
};

export type TpaRequest = {
  requestId: string;
  fromPlayerId: string;
  fromName: string;
  toPlayerId: string;
  toName: string;
  createdAt: number;
  expiresAt: number;
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

export type TeamHomeLocation = {
  x: number;
  y: number;
  z: number;
  dimensionId: string;
};

export type TeamHomeConfig = {
  enabled: boolean;
  maxHomesPerTeam: number;
  allowCrossDimension: boolean;
  blockWhileInCombat: boolean;
};

export type TeamHomeStore = {
  config: TeamHomeConfig;
  homesByTeamId: Record<string, Record<string, TeamHomeLocation>>;
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
  showSidebar: boolean;
};

export type PlayerSettingsConfig = {
  enabled: boolean;
  defaultAllowTpa: boolean;
  defaultAllowPay: boolean;
  defaultShowSocialMessages: boolean;
  defaultShowSidebar: boolean;
};

export type PlayerSettingsStore = {
  config: PlayerSettingsConfig;
  players: Record<string, PlayerSettings>;
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

export type PlayerProfileSection = "summary" | "stats" | "rank" | "shop" | "custom";

export type PlayerProfileConfig = {
  enabled: boolean;
  sections: PlayerProfileSection[];
  customFields: string[];
};

export type PlayerProfilesStore = {
  configs: Record<string, PlayerProfileConfig>;
};
