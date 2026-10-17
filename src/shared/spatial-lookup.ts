type Point = { x: number; z: number };
type Bounds = { dimensionId: string; min: Point; max: Point };

// Entries arrive in priority order; merging bucket and broad entries preserves it.
export function createSpatialLookup<T>(entries: T[], boundsOf: (entry: T) => Bounds): (point: Point, dimensionId: string) => T[] {
  const buckets = new Map<string, number[]>();
  const broad = new Map<string, number[]>();
  for (let index = 0; index < entries.length; index++) {
    const bounds = boundsOf(entries[index]);
    const minX = Math.floor(bounds.min.x / 64), maxX = Math.floor(bounds.max.x / 64);
    const minZ = Math.floor(bounds.min.z / 64), maxZ = Math.floor(bounds.max.z / 64);
    if (!Number.isFinite(minX + maxX + minZ + maxZ) || (maxX - minX + 1) * (maxZ - minZ + 1) > 4096) {
      const list = broad.get(bounds.dimensionId) ?? [];
      list.push(index);
      broad.set(bounds.dimensionId, list);
      continue;
    }
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const key = `${bounds.dimensionId}:${x}:${z}`;
      const list = buckets.get(key) ?? [];
      list.push(index);
      buckets.set(key, list);
    }
  }
  return (point: Point, dimensionId: string): T[] => {
    const local = buckets.get(`${dimensionId}:${Math.floor(point.x / 64)}:${Math.floor(point.z / 64)}`) ?? [];
    const large = broad.get(dimensionId) ?? [];
    const result: T[] = [];
    let a = 0, b = 0;
    while (a < local.length || b < large.length) {
      const index = b >= large.length || (a < local.length && local[a] < large[b]) ? local[a++] : large[b++];
      result.push(entries[index]);
    }
    return result;
  };
}
