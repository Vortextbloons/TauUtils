import { Player, world } from "@minecraft/server";
import { state } from "./storage/state";
import { getPlayerId, getPlayerRank } from "./storage/players";
import { getCombatStatusText } from "./combat-status";

const ERROR_PLACEHOLDER = "§c[error]§r";
const PLAYER_PLACEHOLDERS = new Set([
  "player",
  "name",
  "money",
  "moeny",
  "ping",
  "pos",
  "tps",
  "health",
  "health_color",
  "rank",
  "kills",
  "killstreak",
  "longest_killstreak",
  "combat_status",
]);

export type TemplateContext = {
  player?: Player;
  killer?: Player;
  victim?: Player;
  moneyObjective?: string;
  extra?: Record<string, string | number | boolean | undefined>;
};

function formatNumber(value: number): string {
  return Math.floor(value).toLocaleString("en-US");
}

function getPlayerMoney(player: Player, objectiveId?: string): number {
  const objective = world.scoreboard.getObjective(objectiveId ?? "money");
  if (!objective || !player.scoreboardIdentity) return 0;
  try {
    return objective.getScore(player.scoreboardIdentity) ?? 0;
  } catch {
    return 0;
  }
}

function getPlayerPing(player: Player): string {
  const value = player.getDynamicProperty("ping");
  const ping = typeof value === "number" ? value : Number(value);
  return Number.isFinite(ping) ? `${Math.round(ping)}ms` : "N/A";
}

function getPlayerPlaceholder(key: string, player: Player, moneyObjective?: string, extra?: Record<string, string | number | boolean | undefined>): string {
  if (key === "player" || key === "name") return player.name;
  if (key === "money" || key === "moeny") return formatNumber(getPlayerMoney(player, moneyObjective));
  if (key === "ping") return getPlayerPing(player);
  if (key === "pos") return `${Math.floor(player.location.x)}, ${Math.floor(player.location.y)}, ${Math.floor(player.location.z)}`;
  if (key === "tps") return String(extra?.tps ?? "20.0");
  if (key === "health" || key === "health_color") {
    const health = player.getComponent("minecraft:health") as { currentValue?: number } | undefined;
    const healthValue = Math.floor(health?.currentValue ?? 20);
    if (key === "health") return String(healthValue);
    return healthValue < 5 ? "§c" : healthValue < 10 ? "§6" : "§a";
  }
  if (key === "rank") {
    const rank = getPlayerRank(player.name);
    return rank ? `${rank.color}${rank.name}§r` : "";
  }
  if (key === "combat_status") {
    return getCombatStatusText(player);
  }
  const stats = state.stats.players[getPlayerId(player)];
  if (key === "kills") return formatNumber(stats?.kills ?? 0);
  if (key === "killstreak") return formatNumber(stats?.killstreak ?? 0);
  if (key === "longest_killstreak") return formatNumber(stats?.longestKillstreak ?? 0);
  return ERROR_PLACEHOLDER;
}

function valueToString(value: string | number | boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return String(value);
}

function normalizeExtra(extra: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  const normalized: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(extra)) normalized[key.toLowerCase()] = value;
  return normalized;
}

function subjectForKey(key: string, context: TemplateContext): { player: Player; key: string } | undefined {
  if (key === "killer" && context.killer) return { player: context.killer, key: "player" };
  if (key === "victim" && context.victim) return { player: context.victim, key: "player" };
  if (key.startsWith("killer_") && context.killer) return { player: context.killer, key: key.slice("killer_".length) };
  if (key.startsWith("victim_") && context.victim) return { player: context.victim, key: key.slice("victim_".length) };
  if (PLAYER_PLACEHOLDERS.has(key) && context.player) return { player: context.player, key };
  return undefined;
}

export function renderTemplate(raw: string | undefined, context: TemplateContext = {}): string {
  if (!raw) return "";
  if (!String(raw).includes("[") && !String(raw).includes("{")) return String(raw);
  const extra = context.extra ?? {};
  const normalizedExtra = normalizeExtra(extra);
  const playerPlaceholderCache = new Map<string, string>();
  let rendered = String(raw);

  for (const [key, value] of Object.entries(extra)) {
    const text = valueToString(value);
    if (text === undefined) continue;
    rendered = rendered.split(`{${key}}`).join(text).split(`[${key}]`).join(text);
  }

  if (context.player) {
    rendered = rendered.split("{player}").join(context.player.name);
  }
  if (context.killer) {
    rendered = rendered.split("{killer}").join(context.killer.name);
  }
  if (context.victim) {
    rendered = rendered.split("{victim}").join(context.victim.name);
  }

  rendered = rendered.replace(/\[([a-zA-Z0-9_:-]+)\]/g, (_match, rawKey: string) => {
    const key = String(rawKey).toLowerCase();
    const explicit = valueToString(normalizedExtra[key]);
    if (explicit !== undefined) return explicit;
    const subject = subjectForKey(key, context);
    if (subject) {
      const cacheKey = `${subject.player.id}:${subject.key}:${context.moneyObjective ?? ""}`;
      const cached = playerPlaceholderCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const value = getPlayerPlaceholder(subject.key, subject.player, context.moneyObjective, normalizedExtra);
      playerPlaceholderCache.set(cacheKey, value);
      return value;
    }
    if (PLAYER_PLACEHOLDERS.has(key) || key.startsWith("killer_") || key.startsWith("victim_") || key === "killer" || key === "victim") return ERROR_PLACEHOLDER;
    return ERROR_PLACEHOLDER;
  });

  return rendered;
}

export function renderCommandTemplate(raw: string | undefined, context: TemplateContext = {}): string {
  return renderTemplate(raw, context).trim().replace(/^\/+/, "");
}
