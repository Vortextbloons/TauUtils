import { Player, world } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS, type KillConditionRule, type KillConditionScoreAction } from "../../types";
import { getPlayerId, isOperator, normalizeKey, state, tell } from "../../storage";
import { updateHomesConfig, updatePayConfig, updatePlayerSettingsConfig, updateTpaConfig } from "../../social";
import { updateTeamHomesConfig } from "../../team-homes";
import { acceptTeamInvite, getPlayerTeam, getTeamSummary, inviteToTeam, listTeams, revokeTeamInvite } from "../../teams";
import {
  commitKillConditionActions,
  commitKillConditionRule,
  createKillConditionRule,
  deleteKillConditionRule,
  duplicateKillConditionRule,
  getKillConditionRule,
  setKillConditionsEnabled,
  updateCombatConfig,
} from "../../combat";

export async function showSocialSettingsAdmin(player: Player) {
  if (!isOperator(player)) return;
  const tpa = state.tpa.config;
  const homes = state.homes.config;
  const pay = state.pay.config;
  const playerCfg = state.playerSettings.config;
  const teamHomes = state.teamHomes.config;

  const result = await TauUi.modal("Social Settings")
    .toggle("tpaEnabled", "TPA enabled", tpa.enabled)
    .text("tpaTimeout", "TPA timeout (s)", { placeholder: "60", defaultValue: String(tpa.timeoutSeconds) })
    .text("tpaCooldown", "TPA cooldown (s)", { placeholder: "20", defaultValue: String(tpa.cooldownSeconds) })
    .toggle("tpaNotifyModal", "Notify incoming TPA via modal", tpa.notifyViaModal)
    .toggle("homesEnabled", "Homes enabled", homes.enabled)
    .text("maxHomes", "Max homes", { placeholder: "2", defaultValue: String(homes.maxHomesDefault) })
    .toggle("allowCrossDim", "Allow cross-dimension homes", homes.allowCrossDimension)
    .toggle("payEnabled", "Pay enabled", pay.enabled)
    .text("currencyObjective", "Currency objective", { placeholder: "money", defaultValue: pay.currencyObjective })
    .text("minPay", "Min pay", { placeholder: "1", defaultValue: String(pay.minAmount) })
    .text("maxPay", "Max pay", { placeholder: "100000", defaultValue: String(pay.maxAmount) })
    .text("taxPercent", "Tax %", { placeholder: "0", defaultValue: String(pay.taxPercent) })
    .toggle("playerCfgEnabled", "Player config enabled", playerCfg.enabled)
    .toggle("teamHomesEnabled", "Team homes enabled", teamHomes.enabled)
    .text("maxTeamHomes", "Max team homes per team", { placeholder: "5", defaultValue: String(teamHomes.maxHomesPerTeam) })
    .toggle("allowCrossDimTeamHomes", "Allow cross-dimension team homes", teamHomes.allowCrossDimension)
    .toggle("blockTeamHomesInCombat", "Block team-home TP while in combat", teamHomes.blockWhileInCombat)
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;

  updateTpaConfig({
    enabled: Boolean(result.values.tpaEnabled),
    timeoutSeconds: Math.max(5, Math.floor(Number(result.values.tpaTimeout ?? 60))),
    cooldownSeconds: Math.max(1, Math.floor(Number(result.values.tpaCooldown ?? 20))),
    notifyViaModal: Boolean(result.values.tpaNotifyModal),
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
  updateTeamHomesConfig({
    enabled: Boolean(result.values.teamHomesEnabled),
    maxHomesPerTeam: Math.max(1, Math.floor(Number(result.values.maxTeamHomes ?? 5))),
    allowCrossDimension: Boolean(result.values.allowCrossDimTeamHomes),
    blockWhileInCombat: Boolean(result.values.blockTeamHomesInCombat),
  });
  tell(player, "Social settings saved.");
}

function splitCsv(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => normalizeKey(entry.trim()))
    .filter((entry) => entry.length > 0);
}

function formatKillRuleLine(rule: KillConditionRule): string {
  return `${rule.enabled ? "§aON" : "§cOFF"}§r ${rule.name} §7(${rule.actions.length} actions, priority ${rule.priority})`;
}

async function editKillConditionRuleDetails(player: Player, ruleId: string): Promise<void> {
  const rule = getKillConditionRule(ruleId);
  if (!rule) {
    tell(player, "Kill rule no longer exists.");
    return;
  }
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
  const minStreak = String(result.values.minStreak ?? "").trim();
  const maxStreak = String(result.values.maxStreak ?? "").trim();
  const minKills = String(result.values.minKills ?? "").trim();
  const next: KillConditionRule = {
    ...rule,
    name: String(result.values.name ?? rule.name).trim() || rule.name,
    enabled: Boolean(result.values.enabled),
    priority: Math.floor(Number(result.values.priority ?? 0)) || 0,
    filters: {
      ...filters,
      requireKillerRankMatch: Boolean(result.values.filterKiller),
      killerRanks: splitCsv(result.values.killerRanks),
      requireVictimRankMatch: Boolean(result.values.filterVictim),
      victimRanks: splitCsv(result.values.victimRanks),
      minKillerKillstreak: minStreak ? Math.max(0, Math.floor(Number(minStreak))) : undefined,
      maxKillerKillstreak: maxStreak ? Math.max(0, Math.floor(Number(maxStreak))) : undefined,
      minKillerKills: minKills ? Math.max(0, Math.floor(Number(minKills))) : undefined,
    },
  };
  const saved = commitKillConditionRule(next);
  tell(player, saved.ok ? "Kill rule saved." : `§c${saved.message}`);
}

async function addKillScoreAction(player: Player, ruleId: string, index?: number): Promise<void> {
  const rule = getKillConditionRule(ruleId);
  if (!rule) {
    tell(player, "Kill rule no longer exists.");
    return;
  }
  const current = index === undefined ? undefined : rule.actions[index];
  const currentScore = current?.type === "score" ? current : undefined;
  const operations: KillConditionScoreAction["operation"][] = ["add", "set", "remove"];
  const targets: KillConditionScoreAction["target"][] = ["killer", "victim"];
  const result = await TauUi.modal(currentScore ? "Edit Score Action" : "Add Score Action")
    .dropdown("target", "Target", targets, Math.max(0, targets.indexOf(currentScore?.target ?? "killer")))
    .text("objective", "Objective", { placeholder: "money", defaultValue: currentScore?.objective ?? "money" })
    .dropdown("operation", "Operation", operations, Math.max(0, operations.indexOf(currentScore?.operation ?? "add")))
    .text("amount", "Amount", { placeholder: "100", defaultValue: String(currentScore?.amount ?? 100) })
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
  const live = getKillConditionRule(ruleId);
  if (!live) {
    tell(player, "Kill rule no longer exists.");
    return;
  }
  const actions = live.actions.slice();
  if (index === undefined) actions.push(action);
  else {
    if (index < 0 || index >= actions.length) return;
    actions[index] = action;
  }
  tellCommitResult(player, commitKillConditionActions(ruleId, actions));
}

async function addKillCommandAction(player: Player, ruleId: string, index?: number): Promise<void> {
  const rule = getKillConditionRule(ruleId);
  if (!rule) {
    tell(player, "Kill rule no longer exists.");
    return;
  }
  const current = index === undefined ? undefined : rule.actions[index];
  const currentCommand = current?.type === "command" ? current : undefined;
  const result = await TauUi.modal(currentCommand ? "Edit Command Chain" : "Add Command Chain")
    .text("commands", "Commands separated by ; ({killer}, {victim}, [killer_money], [victim_rank])", { placeholder: "say {killer} killed {victim};give @s diamond 1", defaultValue: currentCommand?.commands.join(";") ?? "" })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const commands = String(result.values.commands ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 10);
  if (commands.length === 0) return;
  const live = getKillConditionRule(ruleId);
  if (!live) {
    tell(player, "Kill rule no longer exists.");
    return;
  }
  const actions = live.actions.slice();
  if (index === undefined) actions.push({ type: "command", commands });
  else {
    if (index < 0 || index >= actions.length) return;
    actions[index] = { type: "command", commands };
  }
  tellCommitResult(player, commitKillConditionActions(ruleId, actions));
}

function tellCommitResult(player: Player, result: { ok: boolean; message: string }): void {
  tell(player, result.ok ? `§a${result.message}` : `§c${result.message}`);
}

async function editKillConditionActions(player: Player, ruleId: string): Promise<void> {
  while (true) {
    const rule = getKillConditionRule(ruleId);
    if (!rule) {
      tell(player, "Kill rule no longer exists.");
      return;
    }
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
      await addKillScoreAction(player, rule.id);
      continue;
    }
    if (response.id === "addCommand") {
      await addKillCommandAction(player, rule.id);
      continue;
    }
    if (response.id === "back" || !response.value) return;
    const actionIndex = response.value.index;
    const live = getKillConditionRule(rule.id);
    if (!live || actionIndex >= live.actions.length) return;
    const action = live.actions[actionIndex];
    const manage = TauUi.action("Action").button("edit", "Edit", { iconPath: ICONS.edit }).button("delete", "Delete", { iconPath: ICONS.delete }).button("back", "Back", { iconPath: ICONS.back });
    const picked = await manage.show(player);
    if (TauUi.isCanceledOrBack(picked)) continue;
    if (picked.id === "delete") {
      const afterDelete = getKillConditionRule(rule.id);
      if (!afterDelete) return;
      tellCommitResult(player, commitKillConditionActions(rule.id, afterDelete.actions.filter((_, i) => i !== actionIndex)));
      continue;
    }
    if (action.type === "score") await addKillScoreAction(player, rule.id, actionIndex);
    else await addKillCommandAction(player, rule.id, actionIndex);
  }
}

async function editKillConditionRule(player: Player, ruleId: string): Promise<void> {
  while (true) {
    const rule = getKillConditionRule(ruleId);
    if (!rule) {
      tell(player, "Kill rule no longer exists.");
      return;
    }
    const form = TauUi.action(rule.name)
      .body(formatKillRuleLine(rule))
      .button("edit", "Edit Details/Filters", { iconPath: ICONS.edit })
      .button("actions", "Actions", { iconPath: ICONS.settings })
      .button("duplicate", "Duplicate", { iconPath: ICONS.confirm })
      .button("delete", "Delete", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "edit") await editKillConditionRuleDetails(player, rule.id);
    else if (response.id === "actions") await editKillConditionActions(player, rule.id);
    else if (response.id === "duplicate") {
      const duplicated = duplicateKillConditionRule(rule.id);
      tell(player, duplicated.ok ? "Kill rule duplicated." : `§c${duplicated.message}`);
    } else if (response.id === "delete") {
      const deleted = deleteKillConditionRule(rule.id);
      tell(player, deleted.ok ? "Kill rule deleted." : `§c${deleted.message}`);
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
      tellCommitResult(player, setKillConditionsEnabled(!store.enabled));
      continue;
    }
    if (response.id === "create") {
      const created = createKillConditionRule();
      if (!created.ok || !created.rule) {
        tell(player, `§c${created.message}`);
        continue;
      }
      await editKillConditionRule(player, created.rule.id);
      continue;
    }
    if (response.id === "back" || !response.value) return;
    const rule = rules[response.value.index];
    if (!rule) return;
    await editKillConditionRule(player, rule.id);
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
    if (TauUi.isCanceledOrBack(picked)) return;
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

    tellCommitResult(player, updateCombatConfig({
      enabled: Boolean(result.values.enabled),
      combatTimeSeconds: Math.max(1, Math.floor(Number(result.values.combatTime ?? 15))),
      announceLogouts: Boolean(result.values.announceLogouts),
      blockCommands: Boolean(result.values.blockCommands),
      enterMessage: String(result.values.enterMessage ?? combat.enterMessage).trim() || combat.enterMessage,
      exitMessage: String(result.values.exitMessage ?? combat.exitMessage).trim() || combat.exitMessage,
      logoutBroadcastMessage: String(result.values.logoutBroadcast ?? combat.logoutBroadcastMessage).trim() || combat.logoutBroadcastMessage,
      rejoinPenaltyMessage: String(result.values.rejoinPenalty ?? combat.rejoinPenaltyMessage).trim() || combat.rejoinPenaltyMessage,
      blockedCommandMessage: String(result.values.blockedCommand ?? combat.blockedCommandMessage).trim() || combat.blockedCommandMessage,
    }));
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
    if (TauUi.isCanceledOrBack(response)) return;

    if (response.id === "invite") {
      if (online.length === 0) {
        tell(player, "No online players available to invite.");
        continue;
      }
      const pick = TauUi.action<{ index: number }>("Invite Player").body("Select a player to invite.");
      online.forEach((p, i) => pick.button("player", p.name, { iconPath: ICONS.menu, value: { index: i } }));
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (TauUi.isCanceledOrBack(picked) || !picked.value) continue;
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
      if (TauUi.isCanceledOrBack(picked) || !picked.value) continue;
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
    if (TauUi.isCanceledOrBack(response)) return;

    if (response.id === "accept") {
      const pick = TauUi.action<{ index: number }>("Accept Team Invite").body("Select a team invite to accept.");
      invitedTeams.forEach((team, i) => pick.button("team", getTeamSummary(team), { iconPath: ICONS.confirm, value: { index: i } }));
      pick.button("back", "Back", { iconPath: ICONS.back });
      const picked = await pick.show(player);
      if (TauUi.isCanceledOrBack(picked) || !picked.value) continue;
      tell(player, acceptTeamInvite(player, invitedTeams[picked.value.index].id).message);
      return;
    }
  }
}
