import { Player, system, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ICONS, type SidebarDefinition } from "./tau-models";
import { getPlayerRank, isOperator, saveSidebars, state, tell } from "./storage";

let sidebarTick = 0;
let tpsSampleTick = 0;
let tpsSampleTime = Date.now();
let cachedTps = "20.0";

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
  saveSidebars();
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

function formatNumber(value: number): string {
  return Math.floor(value).toLocaleString("en-US");
}

function getPlayerMoney(player: Player, objectiveId?: string): number {
  const id = objectiveId ?? "money";
  const objective = world.scoreboard.getObjective(id);
  if (!objective) return 0;
  const identity = player.scoreboardIdentity;
  if (!identity) return 0;
  return objective.getScore(identity) ?? 0;
}

function getPlayerPing(player: Player): number {
  const value = player.getDynamicProperty("ping");
  const ping = typeof value === "number" ? value : Number(value);
  return Number.isFinite(ping) ? ping : Number.NaN;
}

function getServerTps(): string {
  return cachedTps;
}

function pickSidebarForPlayer(player: Player): SidebarDefinition | undefined {
  if (!state.sidebars.enabled) return undefined;

  const candidates = Object.values(state.sidebars.sidebars).filter((sidebar) => sidebar.enabled);
  if (candidates.length === 0) return undefined;

  const tagged = player
    .getTags()
    .filter((tag) => tag.startsWith("sidebar:"))
    .map((tag) => tag.slice("sidebar:".length));

  const matched = candidates.filter((sidebar) => tagged.includes(sidebar.id));
  const pool = matched.length > 0 ? matched : candidates;
  pool.sort((a, b) => b.priority - a.priority);
  return pool[0];
}

function replacePlaceholders(player: Player, sidebar: SidebarDefinition, line: string): string {
  const pos = `${Math.floor(player.location.x)}, ${Math.floor(player.location.y)}, ${Math.floor(player.location.z)}`;
  const money = getPlayerMoney(player, sidebar.moneyObjective);
  const health = player.getComponent("minecraft:health") as { currentValue?: number } | undefined;
  const healthValue = Math.floor(health?.currentValue ?? 20);
  const healthColor = healthValue < 5 ? "§c" : healthValue < 10 ? "§6" : "§a";
  const ping = getPlayerPing(player);

  const rank = getPlayerRank(player.name);
  const rankText = rank ? `${rank.color}${rank.name}§r` : "";

  return line
    .split("[name]").join(player.name)
    .split("[money]").join(formatNumber(money))
    .split("[ping]").join(Number.isFinite(ping) ? `${Math.round(ping)}ms` : "N/A")
    .split("[pos]").join(pos)
    .split("[tps]").join(getServerTps())
    .split("[health]").join(String(healthValue))
    .split("[health_color]").join(healthColor)
    .split("[rank]").join(rankText);
}

function buildSidebarLines(player: Player, sidebar: SidebarDefinition): string[] {
  const lines: string[] = [];
  for (const line of sidebar.lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines.push(trimmed);
    if (lines.length >= 15) break;
  }
  if (!sidebar.scroll || lines.length <= 1) {
    return lines.map((line) => replacePlaceholders(player, sidebar, line));
  }
  const interval = Math.max(1, sidebar.updateInterval);
  const offset = Math.floor(sidebarTick / interval) % lines.length;
  const rotated = [...lines.slice(offset), ...lines.slice(0, offset)];
  return rotated.map((line) => replacePlaceholders(player, sidebar, line));
}

function truncateLine(line: string, max = 80): string {
  if (line.length <= max) return line;
  return line.slice(0, max - 1) + "…";
}

function buildSidebarText(player: Player, sidebar: SidebarDefinition): string {
  const title = truncateLine(replacePlaceholders(player, sidebar, sidebar.title), 80);
  const lines = buildSidebarLines(player, sidebar).map((line) => truncateLine(line));
  return [title, ...lines].filter((line) => line.length > 0).join("\n");
}

function applySidebarForPlayer(player: Player, sidebar: SidebarDefinition) {
  const text = buildSidebarText(player, sidebar);
  player.onScreenDisplay.setActionBar(text || "§r");
}

function renderSidebarTick() {
  sidebarTick++;
  for (const player of world.getPlayers()) {
    const sidebar = pickSidebarForPlayer(player);
    if (!sidebar) continue;
    applySidebarForPlayer(player, sidebar);
  }
}

function sampleTpsTick() {
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
  ensureDefaultSidebarExists();
  ensureSidebarDefaults();
  sanitizeAllSidebars();
  system.runInterval(sampleTpsTick, 1);
  system.runInterval(renderSidebarTick, 5);
}

async function createOrEditSidebar(player: Player, sidebarId?: string) {
  const current = sidebarId ? state.sidebars.sidebars[sidebarId] : undefined;
  const modal = new ModalFormData()
    .title(current ? `Edit Sidebar: ${current.id}` : "Create Sidebar")
    .textField("Sidebar ID", "main_hud", { defaultValue: current?.id ?? "" })
    .textField("Title", "§l§bMY SERVER§r", { defaultValue: current?.title ?? "§l§bMY SERVER§r" })
    .textField("Update interval (ticks)", "20", { defaultValue: String(current?.updateInterval ?? 20) })
    .textField("Priority", "10", { defaultValue: String(current?.priority ?? 10) })
    .textField("Money objective", "money", { defaultValue: current?.moneyObjective ?? "money" })
    .toggle("Enabled", { defaultValue: current?.enabled ?? true })
    .toggle("Scroll lines", { defaultValue: current?.scroll ?? false })
    .submitButton("Save");

  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;

  const id = String(result.formValues[0] ?? "").trim();
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
  existing.title = String(result.formValues[1] ?? "").trim() || "Sidebar";
  existing.updateInterval = Math.max(1, Math.floor(Number(result.formValues[2] ?? 20)));
  existing.priority = Math.floor(Number(result.formValues[3] ?? 10));
  existing.moneyObjective = String(result.formValues[4] ?? "money").trim() || "money";
  existing.enabled = Boolean(result.formValues[5]);
  existing.scroll = Boolean(result.formValues[6]);
  existing.lines = existing.lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 15);
  if (existing.lines.length === 0) existing.lines = ["Player: [name]"];

  state.sidebars.sidebars[id] = existing;
  state.sidebars.defaultSidebarId ??= id;
  saveSidebars();
  tell(player, `Saved sidebar ${id}.`);
}

async function editSidebarLines(player: Player, sidebar: SidebarDefinition) {
  const modal = new ModalFormData().title(`Lines: ${sidebar.id}`);
  for (let i = 0; i < 15; i++) {
    modal.textField(`Line ${i + 1}`, "", { defaultValue: sidebar.lines[i] ?? "" });
  }
  modal.submitButton("Save");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;

  const cleaned = result.formValues
    .map((v) => String(v ?? "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 15);
  sidebar.lines = cleaned.length > 0 ? cleaned : ["Player: [name]"];
  saveSidebars();
  tell(player, `Updated lines for ${sidebar.id}.`);
}

async function setSidebarDefault(player: Player) {
  const ids = Object.keys(state.sidebars.sidebars);
  if (ids.length === 0) {
    tell(player, "No sidebars exist.");
    return;
  }
  const picker = new ActionFormData().title("Set Default Sidebar");
  for (const id of ids) picker.button(id, ICONS.sidebar);
  picker.button("Cancel", ICONS.cancel);
  const response = await picker.show(player).catch(() => undefined);
  if (!response || response.canceled || response.selection === undefined) return;
  if (response.selection >= ids.length) return;
  state.sidebars.defaultSidebarId = ids[response.selection];
  saveSidebars();
  tell(player, `Default sidebar set to ${ids[response.selection]}.`);
}

export async function showSidebarEditor(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit sidebars.");
    return;
  }

  while (true) {
    const ids = Object.keys(state.sidebars.sidebars);
    const form = new ActionFormData()
      .title("Sidebar Customizer")
      .body(`Enabled: ${state.sidebars.enabled ? "Yes" : "No"}\nSidebars: ${ids.length}`)
      .button("Toggle ON/OFF", ICONS.settings)
      .button("Create Sidebar", ICONS.confirm)
      .button("Edit Sidebar", ICONS.edit)
      .button("Edit Lines", ICONS.menu)
      .button("Set Default", ICONS.sidebar)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (response.selection === 0) {
      state.sidebars.enabled = !state.sidebars.enabled;
      saveSidebars();
      tell(player, `Sidebar system ${state.sidebars.enabled ? "enabled" : "disabled"}.`);
      continue;
    }

    if (response.selection === 1) {
      await createOrEditSidebar(player);
      continue;
    }

    if (response.selection === 2 || response.selection === 3) {
      if (ids.length === 0) {
        tell(player, "No sidebars exist.");
        continue;
      }
      const picker = new ActionFormData().title("Pick Sidebar");
      for (const id of ids) picker.button(id, ICONS.sidebar);
      picker.button("Cancel", ICONS.cancel);
      const pick = await picker.show(player).catch(() => undefined);
      if (!pick || pick.canceled || pick.selection === undefined) continue;
      if (pick.selection >= ids.length) continue;
      const id = ids[pick.selection];
      if (response.selection === 2) await createOrEditSidebar(player, id);
      else await editSidebarLines(player, state.sidebars.sidebars[id]);
      continue;
    }

    if (response.selection === 4) {
      await setSidebarDefault(player);
      continue;
    }

    return;
  }
}
