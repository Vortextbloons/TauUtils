// Shared numeric parsing helpers for admin modals and stored config values.
//
// Rule: a failed parse keeps the caller's existing value (fallback) instead of
// writing NaN or 0 into the store. Finite values are clamped into [min, max].

export const MAX_SAFE_INT: number = Number.MAX_SAFE_INTEGER;
export const MIN_SAFE_INT: number = Number.MIN_SAFE_INTEGER;

export function parseFinite(value: unknown, fallback: number): number {
  const num: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function parseIntIn(value: unknown, min: number, max: number, fallback: number): number {
  const num: number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored: number = Math.floor(num);
  if (floored < min) return min;
  if (floored > max) return max;
  return floored;
}

export function parseFloatIn(value: unknown, min: number, max: number, fallback: number): number {
  const num: number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}
