export type ClaimVector = { x: number; y: number; z: number };

export type ClaimAnnouncementTarget = "player" | "owner" | "claim_members" | "team" | "global";

export type ClaimMemberRole = "viewer" | "member" | "manager";

export type ClaimFlags = {
  protectionEnabled: boolean;
  blockBreak: boolean;
  blockPlace: boolean;
  itemUse: boolean;
  entityInteract: boolean;
  pvp: boolean;
  allowTeamAccess: boolean;
};

export type ClaimDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  ownerPlayerId: string;
  ownerName?: string;
  teamId?: string;
  dimensionId: string;
  min: ClaimVector;
  max: ClaimVector;
  createdAt: number;
  updatedAt: number;
  priority: number;
  flags: ClaimFlags;
  members: Record<string, ClaimMemberRole>;
  trustedTeams: Record<string, ClaimMemberRole>;
  enterMessage?: string;
  leaveMessage?: string;
  announceEnter: boolean;
  announceLeave: boolean;
  announcementTarget: ClaimAnnouncementTarget;
};

export type ClaimConfig = {
  enabled: boolean;
  protectionEnabled: boolean;
  allowPlayersToToggleProtection: boolean;
  maxClaimsPerPlayer: number;
  maxClaimsPerTeam: number;
  minClaimSize: ClaimVector;
  maxClaimSize: ClaimVector;
  maxClaimVolume: number;
  allowOverlaps: boolean;
  checkIntervalTicks: number;
  defaultFlags: ClaimFlags;
  playerEditableFlags: Partial<Record<keyof ClaimFlags, boolean>>;
  announcementTargets: ClaimAnnouncementTarget[];
};

export type ClaimStore = {
  config: ClaimConfig;
  claims: Record<string, ClaimDefinition>;
  playerClaimIds: Record<string, string[]>;
  teamClaimIds: Record<string, string[]>;
};
