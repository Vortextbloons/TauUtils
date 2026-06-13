import { pickWeighted } from "../shared/weighted-pick";
import { normalizeItemId } from "../shared/item-id";
import type { GeneratorDefinition, GeneratorOutputEntry } from "../types/game";

function normalizeOutputPool(pool: GeneratorOutputEntry[] | undefined): GeneratorOutputEntry[] {
  return (pool ?? []).filter(
    (entry) => Number.isFinite(entry.weight) && entry.weight > 0 && String(entry.itemId ?? "").trim().length > 0
  );
}

export function getValidOutputPool(definition: GeneratorDefinition): GeneratorOutputEntry[] {
  return normalizeOutputPool(definition.outputPool);
}

export function getTierOutputPool(definition: GeneratorDefinition, tierNumber?: number): GeneratorOutputEntry[] {
  if (definition.kind !== "weighted") return [];
  const tier = tierNumber !== undefined ? definition.tiers.find((entry) => entry.tier === Math.floor(tierNumber)) : undefined;
  const tierPool = normalizeOutputPool(tier?.outputPool);
  return tierPool.length > 0 ? tierPool : getValidOutputPool(definition);
}

export function pickGeneratorOutput(definition: GeneratorDefinition, tierNumber?: number): string | undefined {
  if (definition.kind === "weighted") {
    const pool = getTierOutputPool(definition, tierNumber);
    const picked = pickWeighted(pool);
    if (picked) return normalizeItemId(picked.itemId);
    return definition.outputItemId ? normalizeItemId(definition.outputItemId) : undefined;
  }
  if (!definition.outputItemId) return undefined;
  return normalizeItemId(definition.outputItemId);
}

export function getGeneratorOutputFallback(definition: GeneratorDefinition, tierNumber?: number): string {
  if (definition.kind === "weighted") {
    const pool = getTierOutputPool(definition, tierNumber);
    if (pool.length > 0) return normalizeItemId(pool[0].itemId);
    if (definition.outputItemId) return normalizeItemId(definition.outputItemId);
    return "minecraft:stone";
  }
  return normalizeItemId(definition.outputItemId || "minecraft:stone");
}

export function getGeneratorProducesSummary(definition: GeneratorDefinition, tierNumber?: number): string {
  if (definition.kind === "weighted") {
    const pool = getTierOutputPool(definition, tierNumber);
    if (pool.length === 0) return "§c(no valid pool)";
    const preview = pool.slice(0, 3).map((entry) => entry.itemId).join(", ");
    return pool.length > 3 ? `${pool.length} blocks (${preview}, …)` : `${pool.length} blocks (${preview})`;
  }
  return definition.outputItemId;
}
