export type RtpVector = { x: number; y: number; z: number };

export type RtpProtection = {
  enabled: boolean;
  durationSeconds: number;
  preventFallDamage: boolean;
  preventPvpDamage: boolean;
  preventMobDamage: boolean;
  preventFireDamage: boolean;
  resistanceEffect: boolean;
  slowFallingEffect: boolean;
};

export type RtpRegion = {
  id: string;
  name: string;
  enabled: boolean;
  dimensionId: string;
  min: RtpVector;
  max: RtpVector;
  priority: number;
  allowedRanks: string[];
  cooldownSeconds?: number;
  fallFromSky: boolean;
  skyHeightOffset: number;
  safeLanding: boolean;
  maxAttempts: number;
  avoidClaims: boolean;
  avoidCustomAreas: boolean;
  protection: RtpProtection;
};

export type RtpConfig = {
  enabled: boolean;
  defaultRegionId?: string;
  cooldownSeconds: number;
  maxAttempts: number;
  allowCrossDimension: boolean;
  defaultFallFromSky: boolean;
  defaultSkyHeightOffset: number;
  avoidClaims: boolean;
  avoidCustomAreas: boolean;
  defaultProtection: RtpProtection;
};

export type RtpStore = {
  config: RtpConfig;
  regions: Record<string, RtpRegion>;
};
