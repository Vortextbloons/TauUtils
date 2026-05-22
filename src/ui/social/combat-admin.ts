import { Player, world } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS, type KillConditionAction, type KillConditionRule, type KillConditionScoreAction } from "../../types";
import { getPlayerId, isOperator, normalizeKey, saveCombat, state, tell } from "../../storage";
import { updateHomesConfig, updatePayConfig, updatePlayerSettingsConfig, updateTpaConfig } from "../../social";
import { acceptTeamInvite, getPlayerTeam, getTeamSummary, inviteToTeam, listTeams, revokeTeamInvite } from "../../teams";

export async function showSocialSettingsAdmin(player: Player) {
  if (!isOperator(player)) return;
  const tpa = state.tpa.config;
  const homes = state.homes.config;
  const pay = state.pay.config;
  const playerCfg = state.playerSettings.config;

  const result = await TauUi.modal("Social Settings")
    .toggle("tpaEnabled", "TPA enabled", tpa.enabled)
    .text("tpaTimeout", "TPA timeout (s)", { placeholder: "60", defaultValue: String(tpa.timeoutSeconds) })
    .text("tpaCooldown", "TPA cooldown (s)", { placeholder: "20", defaultValue: String(tpa.cooldownSeconds) })
    .toggle("homesEnabled", "Homes enabled", homes.enabled)
    .text("maxHomes", "Max homes", { placeholder: "2", defaultValue: String(homes.maxHomesDefault) })
    .toggle("allowCrossDim", "Allow cross-dimension homes", homes.allowCrossDimension)
    .toggle("payEnabled", "Pay enabled", pay.enabled)
    .text("currencyObjective", "Currency objective", { placeholder: "money", defaultValue: pay.currencyObjective })
    .text("minPay", "Min pay", { placeholder: "1", defaultValue: String(pay.minAmount) })
    .text("maxPay", "Max pay", { placeholder: "100000", defaultValue: String(pay.maxAmount) })
    .text("taxPercent", "Tax %", { placeholder: "0", defaultValue: String(pay.taxPercent) })
    .toggle("playerCfgEnabled", "Player config enabled", playerCfg.enabled)
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;

  updateTpaConfig({
    enabled: Boolean(result.values.tpaEnabled),
    timeoutSeconds: Math.max(5, Math.floor(Number(result.values.tpaTimeout ?? 60))),
    cooldownSeconds: Math.max(1, Math.floor(Number(result.values.tpaCooldown ?? 20))),
  });
  updateHomesConfig({
    enabled: Boolean(result.values.homesEnabled),
    maxHomesDefault: Math.max(1, Math.floor(Number(result.values.maxHomes ?? 2))),
    allowCrossDimension: Boolean(result.values.allowCrossDim),
  });
  updatePayConfig({
    enabled: Boolean(result.values.payEnabled),
    currencyObjective: String(result.values.currencyObjective ?? "money").trim() || "money",
    minAmount: Math.max(1, Math.floor(Number(result.values.minPay ?? 1))),
    maxAmount: Math.max(1, Math.floor(Number(result.values.maxPay ?? 100000))),
    taxPercent: Math.max(0, Math.floor(Number(result.values.taxPercent ?? 0))),
  });
  updatePlayerSettingsConfig({
    enabled: Boolean(result.values.playerCfgEnabled),
  });
  tell(player, "Social settings saved.");
}

function splitCsv(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => normalizeKey(entry.trim()))
    .filter((entry) => entry.length > 0);
}

function createDefaultKillConditionRule(): KillConditionRule {
  const now = Date.now().toString(36);
  return {
    id: `kill_${now}`,
    name: "New Kill Rule",
    enabled: true,
    priority: 0,
    filters: {
      requireKillerRankMatch: false,
      killerRanks: [],
      requireVictimRankMatch: false,
      victimRanks: [],
    },
    actions: [],
  };
}

function formatKillRuleLine(rule: KillConditionRule): string {
  return `${rule.enabled ? "§aON" : "§cOFF"}§r ${rule.name} §7(${rule.actions.length} actions, priority ${rule.priority})`;
}

async function editKillConditionRuleDetails(player: Player, rule: KillConditionRule): Promise<void> {
  const filters = rule.filters;
  const result = await TauUi.modal(`Kill Rule: ${rule.name}`)
    .text("name", "Name", { placeholder: "VIP Kill Reward", defaultValue: rule.name })
    .toggle("enabled", "Enabled", rule.enabled)
    .text("priority", "Priority", { placeholder: "0", defaultValue: String(rule.priority) })
    .toggle("filterKiller", "Filter killer ranks", filters.requireKillerRankMatch)
    .text("killerRanks", "Killer rank IDs (comma)", { placeholder: "vip,admin", defaultValue: filters.killerRanks.join(",") })
    .toggle("filterVictim", "Filter victim ranks", filters.requireVictimRankMatch)
    .text("victimRanks", "Victim rank IDs (comma)", { placeholder: "member,vip", defaultValue: filters.victimRanks.join(",") })
    .text("minStreak", "Min killer killstreak (blank off)", { placeholder: "3", defaultValue: filters.minKillerKillstreak === undefined ? "" : String(filters.minKillerKillstreak) })
    .text("maxStreak", "Max killer killstreak (blank off)", { placeholder: "10", defaultValue: filters.maxKillerKillstreak === undefined ? "" : String(filters.maxKillerKillstreak) })
    .text("minKills", "Min killer total kills (blank off)", { placeholder: "100", defaultValue: filters.minKillerKills === undefined ? "" : String(filters.minKillerKills) })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  rule.name = String(result.values.name ?? rule.name).trim() || rule.name;
  rule.enabled = Boolean(result.values.enabled);
  rule.priority = Math.floor(Number(result.values.priority ?? 0)) || 0;
  filters.requireKillerRankMatch = Boolean(result.values.filterKiller);
  filters.killerRanks = splitCsv(result.values.killerRanks);
  filters.requireVictimRankMatch = Boolean(result.values.filterVictim);
  filters.victimRanks = splitCsv(result.values.victimRanks);
  const minStreak = String(result.values.minStreak ?? "").trim();
  const maxStreak = String(result.values.maxStreak ?? "").trim();
  const minKills = String(result.values.minKills ?? "").trim();
  filters.minKillerKillstreak = minStreak ? Math.max(0, Math.floor(Number(minStreak))) : undefined;
  filters.maxKillerKillstreak = maxStreak ? Math.max(0, Math.floor(Number(maxStreak))) : undefined;
  filters.minKillerKills = minKills ? Math.max(0, Math.floor(Number(minKills))) : undefined;
  saveCombat();
  tell(player, "Kill rule saved.");
}

async function addKillScoreAction(player: Player, rule: KillConditionRule, current?: KillConditionScoreAction): Promise<void> {
  const operations: KillConditionScoreAction["operation"][] = ["add", "set", "remove"];
  const targets: KillConditionScoreAction["target"][] = ["killer", "victim"];
  const result = await TauUi.modal(current ? "Edit Score Action" : "Add Score Action")
    .dropdown("target", "Target", targets, Math.max(0, targets.indexOf(current?.target ?? "killer")))
    .text("objective", "Objective", { placeholder: "money", defaultValue: current?.objective ?? "money" })
    .dropdown("operation", "Operation", operations, Math.max(0, operations.indexOf(current?.operation ?? "add")))
    .text("amount", "Amount", { placeholder: "100", defaultValue: String(current?.amount ?? 100) })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const action: KillConditionScoreAction = {
    type: "score",
    target: targets[Number(result.values.target ?? 0)] ?? "killer",
    objective: String(result.values.objective ?? "money").trim() || "money",
    operation: operations[Number(result.values.operation ?? 0)] ?? "add",
    amount: Math.floor(Number(result.values.amount ?? 0)) || 0,
  };
  if (current) Object.assign(current, action);
  else rule.actions.push(action);
  saveCombat();
}

async function addKillCommandAction(player: Player, rule: KillConditionRule, current?: Extract<KillConditionAction, { type: "command" }>): Promise<void> {
  const result = await TauUi.modal(current ? "Edit Command Chain" : "Add Command Chain")
    .text("commands", "Commands separated by ; ({killer}, {victim}, [killer_money], [victim_rank])", { placeholder: "say {killer} killed {victim};give @s diamond 1", defaultValue: current?.commands.join(";") ?? "" })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const commands = String(result.values.commands ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 10);
  if (commands.length === 0) return;
  if (current) current.commands = commands;
  else rule.actions.push({ type: "command", commands });
  saveCombat();
}

async function editKillConditionActions(player: Player, rule: KillConditionRule): Promise<void> {
  while (true) {
    const form = TauUi.action<{ index: number }>(`Actions: ${rule.name}`).body(`Actions: ${rule.actions.length}`);
    form.button("addScore", "Add Score Action", { iconPath: ICONS.shop });
    form.button("addCommand", "Add Command Chain", { iconPath: ICONS.settings });
    rule.actions.forEach((action, i) => {
      form.button("action", action.type === "score" ? `Score: ${action.target} ${action.operation} ${action.amount} ${action.objective}` : `Commands: ${action.commands.length}`, { iconPath: ICONS.edit, value: { index: i } });
    });
    form.button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled) return;
    if (response.id === "addScore") {
      await addKillScoreAction(player, rule);
      continue;
    }
    if (response.id === "addCommand") {
      await addKillCommandAction(player, rule);
      continue;
    }
    if (response.id === "back" || !response.value) return;
    const actionIndex = response.value.index;
    if (actionIndex >= rule.actions.length) return;
    const action = rule.actions[actionIndex];
    const manage = TauUi.action("Action").button("edit", "Edit", { iconPath: ICONS.edit }).button("delete", "Delete", { iconPath: ICONS.delete }).button("back", "Back", { iconPath: ICONS.back });
    const picked = await manage.show(player);
    if (picked.canceled || picked.id === "back") continue;
    if (picked.id === "delete") {
      rule.actions.splice(actionIndex, 1);
      saveCombat();
      continue;
    }
    if (action.type === "score") await addKillScoreAction(player, rule, action);
    else await addKillCommandAction(player, rule, action);
  }
}

async function editKillConditionRule(player: Player, rule: KillConditionRule): Promise<void> {
  while (true) {
    const form = TauUi.action(rule.name)
      .body(formatKillRuleLine(rule))
      .button("edit", "Edit Details/Filters", { iconPath: ICONS.edit })
      .button("actions", "Actions", { iconPath: ICONS.settings })
      .button("duplicate", "Duplicate", { iconPath: ICONS.confirm })
      .button("delete", "Delete", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;
    if (response.id === "edit") await editKillConditionRuleDetails(player, rule);
    else if (response.id === "actions") await editKillConditionActions(player, rule);
    else if (response.id === "duplicate") {
      state.combat.config.killConditions.rules.push({ ...rule, id: `kill_${Date.now().toString(36)}`, name: `${rule.name} Copy`, filters: { ...rule.filters }, actions: rule.actions.map((action) => ({ ...action })) });
      saveCombat();
      tell(player, "Kill rule duplicated.");
    } else if (response.id === "delete") {
      state.combat.config.killConditions.rules = state.combat.config.killConditions.rules.filter((entry) => entry.id !== rule.id);
      saveCombat();
      tell(player, "Kill rule deleted.");
      return;
    }
  }
}

async function showKillConditionsAdmin(player: Player): Promise<void> {
  while (true) {
    const store = state.combat.config.killConditions;
    const rules = store.rules.slice().sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
    const form = TauUi.action<{ index: number }>("Kill Conditions")
      .body(`Enabled: ${store.enabled ? "Yes" : "No"}\nRules: ${rules.length}`)
      .button("toggle", `Toggle: ${store.enabled ? "On" : "Off"}`, { iconPath: ICONS.settings })
      .button("create", "Create Rule", { iconPath: ICONS.confirm });
    rules.forEach((rule, i) => form.button("rule", formatKillRuleLine(rule), { iconPath: ICONS.edit, value: { index: i } }));
    form.button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled) return;
    if (response.id === "toggle") {
      store.enabled = !store.enabled;
      saveCombat();
      continue;
    }
    if (response.id === "create") {
      const rule = createDefaultKillConditionRule();
      store.rules.push(rule);
      saveCombat();
      await editKillConditionRule(player, rule);
      continue;
    }
    if (response.id === "back" || !response.value) return;
    const rule = rules[response.value.index];
    if (!rule) return;
    await editKillConditionRule(player, rule);
  }
}

export async function showCombatSettingsAdmin(player: Player): Promise<void> {
  if (!isOperator(player)) return;
  while (true) {
    const combat = state.combat.config;
    const menu = TauUi.action("Combat Admin")
      .body(`Combat: ${combat.enabled ? "On" : "Off"}\nKill conditions: ${combat.killConditions.enabled ? "On" : "Off"}`)
      .button("settings", "Combat Settings", { iconPath: ICONS.settings })
      .button("killConditions", "Kill Conditions", { iconPath: ICONS.sidebar })
      .button("back", "Back", { iconPath: ICONS.back });
    const picked = await menu.show(player);
    if (picked.canceled || picked.id === "back") return;
    if (picked.id === "killConditions") {
      await showKillConditionsAdmin(player);
      continue;
    }

    const result = await TauUi.modal("Combat Settings")
      .toggle("enabled", "Combat system enabled", combat.enabled)
      .text("combatTime", "Combat tag time (seconds)", { placeholder: "15", defaultValue: String(combat.combatTimeSeconds) })
      .toggle("announceLogouts", "Announce combat logouts", combat.announceLogouts)
      .toggle("blockCommands", "Block commands while tagged", combat.blockCommands)
      .text("enterMessage", "Enter combat message", { placeholder: "message", defaultValue: combat.enterMessage })
      .text("exitMessage", "Exit combat message", { placeholder: "message", defaultValue: combat.exitMessage })
      .text("logoutBroadcast", "Logout broadcast ({player}, [player])", { placeholder: "Use {player}", defaultValue: combat.logoutBroadcastMessage })
      .text("rejoinPenalty", "Rejoin penalty message", { placeholder: "message", defaultValue: combat.rejoinPenaltyMessage })
      .text("blockedCommand", "Blocked command message", { placeholder: "message", defaultValue: combat.blockedCommandMessage })
      .submitButton("Save")
      .show(player);
    if (result.canceled) return;

    combat.enabled = Boolean(result.values.enabled);
    combat.combatTimeSeconds = Math.max(1, Math.floor(Number(result.values.combatTime ?? 15)));
    combat.announceLogouts = Boolean(result.values.announceLogouts);
    combat.blockCommands = Boolean(result.values.blockCommands);
    combat.enterMessage = String(result.values.enterMessage ?? combat.enterMessage).trim() || combat.enterMessage;
    combat.exitMessage = String(result.values.exitMessage ?? combat.exitMessage).trim() || combat.exitMessage;
    combat.logoutBroadcastMessage = String(result.values.logoutBroadcast ?? combat.logoutBroadcastMessage).trim() || combat.logoutBroadcastMessage;
    combat.rejoinPenaltyMessage = String(result.values.rejoinPenalty ?? combat.rejoinPenaltyMessage).trim() || combat.rejoinPenaltyMessage;
    combat.blockedCommandMessage = String(result.values.blockedCommand ?? combat.blockedCommandMessage).trim() || combat.blockedCommandMessage;
    saveCombat();
    tell(player, "Combat settings saved.");
  }
}

export async function showTeamInviteCenter(player: Player) {
  while (true) {
    const team = getPlayerTeam(player);
    if (!team) {
      tell(player, "You are not in a team.");
      return;
    }

    const online = world.getAllPlayers().filter((p) => p.id !== player.id && !team.memberPlayerIds.includes(getPlayerId(p)) && !team.invitedPlayerIds.includes(getPlayerId(p)));
    const form = TauUi.action(`§a${team.name} Invites§r`)
      .body(`§7Invited players: §f${team.invitedPlayerIds.length}`)
      .button("invite", "Invite Player", { iconPath: ICONS.binding })
      .button("revoke", "Revoke Invite", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "invite") {
      if (online.length === 0) {
        tell(player, "No online players available to invite.");
        continue;
      }
      const pick = TauUi.action<{ index: number }>("Invite Player").body("Select a player to invite.");
      online.forEach((p, i) => pick.button("player", p.name, { iconPath: ICONS.menu, value: { index: i } }));
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back" || !picked.value) continue;
      tell(player, inviteToTeam(player, online[picked.value.index]).message);
      continue;
    }

    if (response.id === "revoke") {
      const invitedPlayers = team.invitedPlayerIds
        .map((memberId) => world.getAllPlayers().find((p) => getPlayerId(p) === memberId))
        .filter((p): p is Player => Boolean(p));
      if (invitedPlayers.length === 0) {
        tell(player, "No pending invites.");
        continue;
      }
      const pick = TauUi.action<{ index: number }>("Revoke Invite").body("Select a player to revoke.");
      invitedPlayers.forEach((p, i) => pick.button("player", p.name, { iconPath: ICONS.delete, value: { index: i } }));
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back" || !picked.value) continue;
      tell(player, revokeTeamInvite(player, invitedPlayers[picked.value.index]).message);
    }
  }
}

export async function showPendingTeamInvites(player: Player) {
  while (true) {
    const playerId = getPlayerId(player);
    const invitedTeams = listTeams().filter((team) => team.invitedPlayerIds.includes(playerId));
    if (invitedTeams.length === 0) {
      tell(player, "You have no pending team invites.");
      return;
    }

    const form = TauUi.action("Pending Invites")
      .body(`§7You have §f${invitedTeams.length}§7 pending invite(s).`)
      .button("accept", "Accept Invite", { iconPath: ICONS.confirm })
      .button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "accept") {
      const pick = TauUi.action<{ index: number }>("Accept Team Invite").body("Select a team invite to accept.");
      invitedTeams.forEach((team, i) => pick.button("team", getTeamSummary(team), { iconPath: ICONS.confirm, value: { index: i } }));
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (picked.canceled || picked.id === "back" || !picked.value) continue;
      tell(player, acceptTeamInvite(player, invitedTeams[picked.value.index].id).message);
      return;
    }
  }
}
