import { Player, system, world } from "@minecraft/server";
import { ICONS, type SidebarDefinition } from "../types";
import { TauUi } from "../ui";
import { getPlayerId, isFeatureEnabled, isOperator, saveSidebars, state, tell } from "../storage";
import { renderTemplate } from "../shared/templates";
import { registerBackgroundTask, registerEveryTickTask } from "../scheduler";
import { getPlayerSettings, setSidebarOptOutHandler } from "../social/core";

let tpsSampleTick = 0;
let tpsSampleTime = Date.now();
let cachedTps = "20.0";

type SidebarRenderCache = {
  sidebarId?: string;
  lastRenderTick: number;
  lastSendTick: number;
  lastText: string;
};

type SidebarRuntime = {
  sidebar: SidebarDefinition;
  lines: string[];
  updateInterval: number;
};

type SidebarRuntimeCache = {
  ordered: SidebarRuntime[];
  byId: Map<string, SidebarRuntime>;
};

let enabledSidebarCache: SidebarRuntimeCache | undefined;
const playerRenderCache = new Map<string, SidebarRenderCache>();
let sidebarRenderJobId: number | undefined;

const DEFAULT_SIDEBAR: SidebarDefinition = {
  id: "main_hud",
  title: "§l§bMY SERVER§r",
  updateInterval: 20,
  priority: 10,
  enabled: true,
  moneyObjective: "money",
  lines: [
    "§7------------------",
    "Player: §e[name]",
    "Balance: §a$[money]",
    "Health: [health_color][health]",
    "Pos: §7[pos]",
    "Ping: §7[ping]",
    "§7------------------",
  ],
};

function createDefaultSidebar(): SidebarDefinition {
  return {
    ...DEFAULT_SIDEBAR,
    lines: [...DEFAULT_SIDEBAR.lines],
  };
}

function ensureSidebarDefaults() {
  if (Object.keys(state.sidebars.sidebars).length > 0) return;
  state.sidebars.sidebars.main_hud = createDefaultSidebar();
  state.sidebars.defaultSidebarId = "main_hud";
  saveSidebarsAndInvalidate();
}

function ensureDefaultSidebarExists() {
  if (state.sidebars.sidebars.main_hud) return;
  state.sidebars.sidebars.main_hud = createDefaultSidebar();
  state.sidebars.defaultSidebarId ??= "main_hud";
}

function sanitizeAllSidebars() {
  for (const sidebar of Object.values(state.sidebars.sidebars)) {
    sidebar.lines = sidebar.lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 15);
    if (sidebar.lines.length === 0) {
      sidebar.lines = ["Player: [name]"];
    }
  }
}

function invalidateSidebarCaches(): void {
  enabledSidebarCache = undefined;
  playerRenderCache.clear();
}

export function invalidatePlayerSidebarCache(player: Player): void {
  playerRenderCache.delete(getPlayerCacheKey(player));
}

export function clearSidebarRuntimeForPlayer(playerId: string): void {
  playerRenderCache.delete(playerId);
}

function saveSidebarsAndInvalidate(): void {
  saveSidebars();
  invalidateSidebarCaches();
}

function getServerTps(): string {
  return cachedTps;
}

function getEnabledSidebarCache(): SidebarRuntimeCache {
  if (!isFeatureEnabled("sidebars") || !state.sidebars.enabled) return { ordered: [], byId: new Map() };
  if (!enabledSidebarCache) {
    const ordered = Object.values(state.sidebars.sidebars)
      .filter((sidebar) => sidebar.enabled)
      .sort((a, b) => b.priority - a.priority)
      .map((sidebar) => ({
        sidebar,
        lines: sidebar.lines.map((line) => line.trim()).filter((line) => line.length > 0).slice(0, 15),
        updateInterval: Math.max(1, Math.floor(sidebar.updateInterval || 20)),
      }));
    enabledSidebarCache = {
      ordered,
      byId: new Map(ordered.map((runtime) => [runtime.sidebar.id, runtime])),
    };
  }
  return enabledSidebarCache;
}

function getEnabledSidebars(): SidebarRuntime[] {
  return getEnabledSidebarCache().ordered;
}

function pickSidebarForPlayer(player: Player): SidebarRuntime | undefined {
  if (!isFeatureEnabled("sidebars") || !state.sidebars.enabled) return undefined;
  if (!getPlayerSettings(player).showSidebar) return undefined;

  const candidates = getEnabledSidebars();
  if (candidates.length === 0) return undefined;
  const byId = getEnabledSidebarCache().byId;

  for (const tag of player.getTags()) {
    if (!tag.startsWith("sidebar:")) continue;
    const id = tag.slice("sidebar:".length);
    const tagged = byId.get(id);
    if (tagged) return tagged;
  }
  return candidates[0];
}

function renderSidebarTemplate(player: Player, sidebar: SidebarDefinition, line: string): string {
  return renderTemplate(line, { player, moneyObjective: sidebar.moneyObjective, extra: { tps: getServerTps() } });
}

function buildSidebarLines(player: Player, runtime: SidebarRuntime): string[] {
  const { sidebar, lines } = runtime;
  if (!sidebar.scroll || lines.length <= 1) {
    return lines.map((line) => renderSidebarTemplate(player, sidebar, line));
  }
  const interval = runtime.updateInterval;
  const offset = Math.floor(system.currentTick / interval) % lines.length;
  const rotated = [...lines.slice(offset), ...lines.slice(0, offset)];
  return rotated.map((line) => renderSidebarTemplate(player, sidebar, line));
}

function truncateLine(line: string, max = 80): string {
  if (line.length <= max) return line;
  return line.slice(0, max - 1) + "…";
}

function buildSidebarText(player: Player, runtime: SidebarRuntime): string {
  const { sidebar } = runtime;
  const title = truncateLine(renderSidebarTemplate(player, sidebar, sidebar.title), 80);
  const lines = buildSidebarLines(player, runtime).map((line) => truncateLine(line));
  return [title, ...lines].filter((line) => line.length > 0).join("\n");
}

function getPlayerCacheKey(player: Player): string {
  return getPlayerId(player);
}

function safeSetActionBar(player: Player, text: string): boolean {
  if (!player.isValid) return false;
  try {
    player.onScreenDisplay.setActionBar(text);
    return true;
  } catch {
    return false;
  }
}

function applySidebarForPlayer(player: Player, runtime: SidebarRuntime) {
  const { sidebar } = runtime;
  const key = getPlayerCacheKey(player);
  const cache = playerRenderCache.get(key);
  const interval = runtime.updateInterval;
  const changedSidebar = cache?.sidebarId !== sidebar.id;
  if (!changedSidebar && cache && system.currentTick - cache.lastRenderTick < interval) {
    if (system.currentTick - cache.lastSendTick >= 20) {
      if (!safeSetActionBar(player, cache.lastText || "§r")) {
        playerRenderCache.delete(key);
      } else {
        cache.lastSendTick = system.currentTick;
      }
    }
    return;
  }

  const text = buildSidebarText(player, runtime);
  if (!safeSetActionBar(player, text || "§r")) {
    playerRenderCache.delete(key);
    return;
  }
  playerRenderCache.set(key, { sidebarId: sidebar.id, lastRenderTick: system.currentTick, lastSendTick: system.currentTick, lastText: text });
}

function renderSidebarTick() {
  if (!isFeatureEnabled("sidebars") || !state.sidebars.enabled) {
    playerRenderCache.clear();
    return;
  }
  if (sidebarRenderJobId !== undefined) return;
  const players = world.getPlayers();
  if (players.length === 0) return;
  sidebarRenderJobId = system.runJob(renderSidebarJob(players));
}

function* renderSidebarJob(players: Player[]): Generator<void, void, void> {
  try {
    for (const player of players) {
      if (!isFeatureEnabled("sidebars") || !state.sidebars.enabled) break;
      if (!player.isValid) {
        try { playerRenderCache.delete(getPlayerCacheKey(player)); } catch { /* ignore */ }
        continue;
      }
      try {
        const sidebar = pickSidebarForPlayer(player);
        if (sidebar) applySidebarForPlayer(player, sidebar);
      } catch {
        try { playerRenderCache.delete(getPlayerCacheKey(player)); } catch { /* ignore */ }
      }
      yield;
    }
  } finally {
    sidebarRenderJobId = undefined;
  }
}

function sampleTpsTick() {
  if (!isFeatureEnabled("sidebars") || !state.sidebars.enabled) return;
  tpsSampleTick++;
  const now = Date.now();
  const elapsed = now - tpsSampleTime;
  if (elapsed >= 1000) {
    const tps = (tpsSampleTick * 1000) / elapsed;
    cachedTps = Math.max(0, Math.min(20, tps)).toFixed(1);
    tpsSampleTick = 0;
    tpsSampleTime = now;
  }
}

export function registerSidebarSystem() {
  setSidebarOptOutHandler(invalidatePlayerSidebarCache);
  ensureDefaultSidebarExists();
  ensureSidebarDefaults();
  sanitizeAllSidebars();
  registerEveryTickTask("sidebar-tps-sample", sampleTpsTick);
  registerBackgroundTask("sidebar-render", 5, renderSidebarTick, 3);
}

async function createOrEditSidebar(player: Player, sidebarId?: string) {
  const current = sidebarId ? state.sidebars.sidebars[sidebarId] : undefined;
  const result = await TauUi.modal(current ? `Edit Sidebar: ${current.id}` : "Create Sidebar")
    .text("sidebarId", "Sidebar ID", { placeholder: "main_hud", defaultValue: current?.id ?? "" })
    .text("title", "Title", { placeholder: "§l§bMY SERVER§r", defaultValue: current?.title ?? "§l§bMY SERVER§r" })
    .text("updateInterval", "Update interval (ticks)", { placeholder: "20", defaultValue: String(current?.updateInterval ?? 20) })
    .text("priority", "Priority", { placeholder: "10", defaultValue: String(current?.priority ?? 10) })
    .text("moneyObjective", "Money objective", { placeholder: "money", defaultValue: current?.moneyObjective ?? "money" })
    .toggle("enabled", "Enabled", current?.enabled ?? true)
    .toggle("scroll", "Scroll lines", current?.scroll ?? false)
    .submitButton("Save")
    .show(player);

  if (result.canceled) return;

  const id = String(result.values.sidebarId ?? "").trim();
  if (!id) {
    tell(player, "Sidebar ID is required.");
    return;
  }

  const existing = state.sidebars.sidebars[id] ?? {
    id,
    title: "",
    updateInterval: 20,
    priority: 10,
    enabled: true,
    lines: ["Player: [name]"],
  };

  existing.id = id;
  existing.title = String(result.values.title ?? "").trim() || "Sidebar";
  existing.updateInterval = Math.max(1, Math.floor(Number(result.values.updateInterval ?? 20)));
  existing.priority = Math.floor(Number(result.values.priority ?? 10));
  existing.moneyObjective = String(result.values.moneyObjective ?? "money").trim() || "money";
  existing.enabled = Boolean(result.values.enabled);
  existing.scroll = Boolean(result.values.scroll);
  existing.lines = existing.lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 15);
  if (existing.lines.length === 0) existing.lines = ["Player: [name]"];

  state.sidebars.sidebars[id] = existing;
  state.sidebars.defaultSidebarId ??= id;
  saveSidebarsAndInvalidate();
  tell(player, `Saved sidebar ${id}.`);
}

async function editSidebarLines(player: Player, sidebar: SidebarDefinition) {
  const form = TauUi.modal(`Lines: ${sidebar.id}`);
  for (let i = 0; i < 15; i++) form.text(`line${i}`, `Line ${i + 1}`, { defaultValue: sidebar.lines[i] ?? "" });
  form.submitButton("Save");
  const result = await form.show(player);
  if (result.canceled) return;

  const cleaned = result.rawValues.map((v) => String(v ?? "").trim()).filter((line) => line.length > 0).slice(0, 15);
  sidebar.lines = cleaned.length > 0 ? cleaned : ["Player: [name]"];
  saveSidebarsAndInvalidate();
  tell(player, `Updated lines for ${sidebar.id}.`);
}

async function setSidebarDefault(player: Player) {
  const ids = Object.keys(state.sidebars.sidebars);
  if (ids.length === 0) {
    tell(player, "No sidebars exist.");
    return;
  }
  const picker = TauUi.action<{ id: string }>("Set Default Sidebar");
  for (const id of ids) picker.button("sidebar", id, { iconPath: ICONS.sidebar, value: { id } });
  picker.button("cancel", "Cancel", { iconPath: ICONS.cancel });
  const response = await picker.show(player);
  if (response.canceled || response.id === "cancel" || !response.value) return;
  state.sidebars.defaultSidebarId = response.value.id;
  saveSidebarsAndInvalidate();
  tell(player, `Default sidebar set to ${response.value.id}.`);
}

export async function showSidebarEditor(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit sidebars.");
    return;
  }

  while (true) {
    const ids = Object.keys(state.sidebars.sidebars);
    const response = await TauUi.action("Sidebar Customizer")
      .body(`Enabled: ${state.sidebars.enabled ? "Yes" : "No"}\nSidebars: ${ids.length}`)
      .button("toggle", "Toggle ON/OFF", { iconPath: ICONS.settings })
      .button("create", "Create Sidebar", { iconPath: ICONS.confirm })
      .button("edit", "Edit Sidebar", { iconPath: ICONS.edit })
      .button("editLines", "Edit Lines", { iconPath: ICONS.menu })
      .button("setDefault", "Set Default", { iconPath: ICONS.sidebar })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (response.canceled || response.id === "back") return;

    if (response.id === "toggle") {
      state.sidebars.enabled = !state.sidebars.enabled;
      saveSidebarsAndInvalidate();
      tell(player, `Sidebar system ${state.sidebars.enabled ? "enabled" : "disabled"}.`);
      continue;
    }

    if (response.id === "create") {
      await createOrEditSidebar(player);
      continue;
    }

    if (response.id === "edit" || response.id === "editLines") {
      if (ids.length === 0) {
        tell(player, "No sidebars exist.");
        continue;
      }
      const picker = TauUi.action<{ id: string }>("Pick Sidebar");
      for (const id of ids) picker.button("sidebar", id, { iconPath: ICONS.sidebar, value: { id } });
      picker.button("cancel", "Cancel", { iconPath: ICONS.cancel });
      const pick = await picker.show(player);
      if (pick.canceled || pick.id === "cancel" || !pick.value) continue;
      if (response.id === "edit") await createOrEditSidebar(player, pick.value.id);
      else await editSidebarLines(player, state.sidebars.sidebars[pick.value.id]);
      continue;
    }

    if (response.id === "setDefault") {
      await setSidebarDefault(player);
      continue;
    }

    return;
  }
}
