import { normalizeKey } from "./normalize-id";

export function normalizeItemId(value: string): string {
  return normalizeKey(value);
}

export function normalizeBlockId(value: string): string {
  const id = normalizeItemId(value);
  if (!id) return id;
  if (id.includes(":")) return id;
  return `minecraft:${id}`;
}
