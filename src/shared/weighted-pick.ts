export type WeightedEntry = { weight: number };

export function pickWeighted<T extends WeightedEntry>(entries: T[]): T | undefined {
  const valid = entries.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
  if (valid.length === 0) return undefined;
  const total = valid.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of valid) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return valid[valid.length - 1];
}
