import type { GeneratorDefinition } from "../types/game";

type GeneratorLocation = {
  dimensionId: string;
  x: number;
  y: number;
  z: number;
};

type GeneratorItemData = {
  definitionId: string;
  tier: number;
  autoBreakerPurchased: boolean;
  autoBreakerEnabled: boolean;
};

const GENERATOR_MARKER_PREFIX = "§0[TAU_GENERATOR:";
const GENERATOR_TIER_PREFIX = "§7Tier: §f";

const generatorCache = {
  definitions: undefined as GeneratorDefinition[] | undefined,
  source: undefined as Record<string, GeneratorDefinition> | undefined,
};

export { type GeneratorLocation, type GeneratorItemData, GENERATOR_MARKER_PREFIX, GENERATOR_TIER_PREFIX, generatorCache };
