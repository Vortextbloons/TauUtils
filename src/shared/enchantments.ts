export function parseEnchantments(raw: string | undefined): { id: string; level: number }[] {
  const entries = String(raw ?? "")
    .split(/[,\n;]/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const result: { id: string; level: number }[] = [];
  for (const entry of entries) {
    const [idRaw, levelRaw] = entry.split("=", 2);
    const id = String(idRaw ?? "").trim();
    const level = Math.max(1, Math.floor(Number(String(levelRaw ?? "1").trim())));
    if (!id) continue;
    result.push({ id, level });
  }
  return result;
}

export function parseEnchantmentsText(raw: string): { id: string; level: number }[] {
  const entries = String(raw ?? "")
    .split(/[\n,;]/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const enchantments: { id: string; level: number }[] = [];
  for (const entry of entries) {
    const [idRaw, levelRaw] = entry.split("=", 2);
    const id = String(idRaw ?? "").trim();
    const level = Math.max(1, Math.floor(Number(String(levelRaw ?? "1").trim())));
    if (!id) continue;
    enchantments.push({ id, level });
  }
  return enchantments;
}
