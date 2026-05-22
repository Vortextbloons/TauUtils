export function normalizeItemId(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeBlockId(value: string): string {
  const id = normalizeItemId(value);
  if (!id) return id;
  if (id.includes(":")) return id;
  return `minecraft:${id}`;
}
