export function normalizeKey(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeId(value: string): string {
  return normalizeKey(value)
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^_+|_+$/g, "");
}

// Legacy fallback for keys stored before strict normalization (raw or
// trim+lowercase ids with spaces/specials). Strict-first callers use this
// only on a miss, so the hot path stays O(1) and old worlds keep resolving.
export function resolveLegacyKey(keys: Iterable<string>, rawId: string): string | undefined {
  const trimmed = String(rawId ?? "").trim();
  if (!trimmed) return undefined;
  const lowered = trimmed.toLowerCase();
  for (const key of keys) {
    if (key === trimmed || key.toLowerCase() === lowered) return key;
  }
  return undefined;
}
