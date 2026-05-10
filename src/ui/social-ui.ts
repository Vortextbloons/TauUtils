import { Player, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ICONS, type KillConditionAction, type KillConditionRule, type KillConditionScoreAction } from "../types";
import { getPlayerId, isFeatureEnabled, isOperator, normalizeKey, saveCombat, state, tell } from "../storage";
import { createTpaRequest, deleteHome, listHomes, payPlayer, setHome, teleportHome, updateHomesConfig, updatePayConfig, updatePlayerSettings, updatePlayerSettingsConfig, updateTpaConfig } from "../social";
import { acceptTeamInvite, createTeam, disbandTeam, getPlayerTeam, getTeamSummary, inviteToTeam, joinTeam, kickFromTeam, leaveTeam, listTeams, revokeTeamInvite, setTeamFriendlyFire, setTeamPlotEnabled } from "../teams";
import { createWarp, deleteWarp, listWarps, setWarpLocation, teleportToWarp } from "../warps";
export async function showTpaMenu(player: Player) {
  const players = world.getAllPlayers().filter((p) => p.id !== player.id);
  if (players.length === 0) {
    tell(player, "No online players available.");
    return;
  }
  const form = new ActionFormData().title("TPA").body("Send a teleport request.");
  for (const p of players) form.button(p.name, ICONS.menu);
  form.button("Back", ICONS.back);
  const res = await form.show(player).catch(() => undefined);
  if (!res || res.canceled || res.selection === undefined) return;
  if (res.selection >= players.length) return;
  const target = players[res.selection];
  const result = createTpaRequest(player, target);
  tell(player, result.message);
  if (result.ok) tell(target, `§e${player.name} sent you a TPA request. Use /tau:tpaccept or /tau:tpdeny.`);
}

export async function showHomesMenu(player: Player) {
  while (true) {
    const homes = listHomes(player);
    const form = new ActionFormData()
      .title("Homes")
      .body(`Your homes: ${homes.length}`)
      .button("Set Home", ICONS.confirm)
      .button("Teleport Home", ICONS.sidebar)
      .button("Delete Home", ICONS.delete)
      .button("Back", ICONS.back);
    const res = await form.show(player).catch(() => undefined);
    if (!res || res.canceled || res.selection === undefined) return;
    if (res.selection === 3) return;

    if (res.selection === 0) {
      const modal = new ModalFormData().title("Set Home").textField("Home name", "home").submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      tell(player, setHome(player, String(result.formValues[0] ?? "home")).message);
      continue;
    }

    if (homes.length === 0) {
      tell(player, "No homes set.");
      continue;
    }

    const pick = new ActionFormData().title(res.selection === 1 ? "Teleport Home" : "Delete Home");
    for (const name of homes) pick.button(name, ICONS.menu);
    pick.button("Back", ICONS.back);
    const picked = await pick.show(player).catch(() => undefined);
    if (!picked || picked.canceled || picked.selection === undefined) continue;
    if (picked.selection >= homes.length) continue;
    const name = homes[picked.selection];
    if (res.selection === 1) tell(player, teleportHome(player, name).message);
    else tell(player, deleteHome(player, name).message);
  }
}

export async function showPayMenu(player: Player) {
  const players = world.getAllPlayers().filter((p) => p.id !== player.id);
  if (players.length === 0) {
    tell(player, "No online players available.");
    return;
  }
  const pick = new ActionFormData().title("Pay Player").body("Select a player to pay.");
  for (const p of players) pick.button(p.name, ICONS.shop);
  pick.button("Back", ICONS.back);
  const picked = await pick.show(player).catch(() => undefined);
  if (!picked || picked.canceled || picked.selection === undefined) return;
  if (picked.selection >= players.length) return;
  const target = players[picked.selection];
  const modal = new ModalFormData().title(`Pay ${target.name}`).textField("Amount", "100").submitButton("Send");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const amount = Number(result.formValues[0] ?? "0");
  const payResult = payPlayer(player, target, amount);
  tell(player, payResult.message);
  if (payResult.ok) tell(target, `§aYou received a payment from ${player.name}.`);
}

export async function showPlayerSettingsMenu(player: Player) {
  const current = state.playerSettings.players[getPlayerId(player)] ?? {
    allowTpa: state.playerSettings.config.defaultAllowTpa,
    allowPay: state.playerSettings.config.defaultAllowPay,
    showSocialMessages: state.playerSettings.config.defaultShowSocialMessages,
  };
  const modal = new ModalFormData()
    .title("Player Settings")
    .toggle("Allow TPA requests", { defaultValue: current.allowTpa })
    .toggle("Allow payments", { defaultValue: current.allowPay })
    .toggle("Show social messages", { defaultValue: current.showSocialMessages })
    .submitButton("Save");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  updatePlayerSettings(player, {
    allowTpa: Boolean(result.formValues[0]),
    allowPay: Boolean(result.formValues[1]),
    showSocialMessages: Boolean(result.formValues[2]),
  });
  tell(player, "Player settings saved.");
}

export async function showSocialSettingsAdmin(player: Player) {
  if (!isOperator(player)) return;
  const tpa = state.tpa.config;
  const homes = state.homes.config;
  const pay = state.pay.config;
  const playerCfg = state.playerSettings.config;

  const modal = new ModalFormData()
    .title("Social Settings")
    .toggle("TPA enabled", { defaultValue: tpa.enabled })
    .textField("TPA timeout (s)", "60", { defaultValue: String(tpa.timeoutSeconds) })
    .textField("TPA cooldown (s)", "20", { defaultValue: String(tpa.cooldownSeconds) })
    .toggle("Homes enabled", { defaultValue: homes.enabled })
    .textField("Max homes", "2", { defaultValue: String(homes.maxHomesDefault) })
    .toggle("Allow cross-dimension homes", { defaultValue: homes.allowCrossDimension })
    .toggle("Pay enabled", { defaultValue: pay.enabled })
    .textField("Currency objective", "money", { defaultValue: pay.currencyObjective })
    .textField("Min pay", "1", { defaultValue: String(pay.minAmount) })
    .textField("Max pay", "100000", { defaultValue: String(pay.maxAmount) })
    .textField("Tax %", "0", { defaultValue: String(pay.taxPercent) })
    .toggle("Player config enabled", { defaultValue: playerCfg.enabled })
    .submitButton("Save");

  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;

  updateTpaConfig({
    enabled: Boolean(result.formValues[0]),
    timeoutSeconds: Math.max(5, Math.floor(Number(result.formValues[1] ?? 60))),
    cooldownSeconds: Math.max(1, Math.floor(Number(result.formValues[2] ?? 20))),
  });
  updateHomesConfig({
    enabled: Boolean(result.formValues[3]),
    maxHomesDefault: Math.max(1, Math.floor(Number(result.formValues[4] ?? 2))),
    allowCrossDimension: Boolean(result.formValues[5]),
  });
  updatePayConfig({
    enabled: Boolean(result.formValues[6]),
    currencyObjective: String(result.formValues[7] ?? "money").trim() || "money",
    minAmount: Math.max(1, Math.floor(Number(result.formValues[8] ?? 1))),
    maxAmount: Math.max(1, Math.floor(Number(result.formValues[9] ?? 100000))),
    taxPercent: Math.max(0, Math.floor(Number(result.formValues[10] ?? 0))),
  });
  updatePlayerSettingsConfig({
    enabled: Boolean(result.formValues[11]),
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
  const modal = new ModalFormData()
    .title(`Kill Rule: ${rule.name}`)
    .textField("Name", "VIP Kill Reward", { defaultValue: rule.name })
    .toggle("Enabled", { defaultValue: rule.enabled })
    .textField("Priority", "0", { defaultValue: String(rule.priority) })
    .toggle("Filter killer ranks", { defaultValue: filters.requireKillerRankMatch })
    .textField("Killer rank IDs (comma)", "vip,admin", { defaultValue: filters.killerRanks.join(",") })
    .toggle("Filter victim ranks", { defaultValue: filters.requireVictimRankMatch })
    .textField("Victim rank IDs (comma)", "member,vip", { defaultValue: filters.victimRanks.join(",") })
    .textField("Min killer killstreak (blank off)", "3", { defaultValue: filters.minKillerKillstreak === undefined ? "" : String(filters.minKillerKillstreak) })
    .textField("Max killer killstreak (blank off)", "10", { defaultValue: filters.maxKillerKillstreak === undefined ? "" : String(filters.maxKillerKillstreak) })
    .textField("Min killer total kills (blank off)", "100", { defaultValue: filters.minKillerKills === undefined ? "" : String(filters.minKillerKills) })
    .submitButton("Save");

  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  rule.name = String(result.formValues[0] ?? rule.name).trim() || rule.name;
  rule.enabled = Boolean(result.formValues[1]);
  rule.priority = Math.floor(Number(result.formValues[2] ?? 0)) || 0;
  filters.requireKillerRankMatch = Boolean(result.formValues[3]);
  filters.killerRanks = splitCsv(result.formValues[4]);
  filters.requireVictimRankMatch = Boolean(result.formValues[5]);
  filters.victimRanks = splitCsv(result.formValues[6]);
  const minStreak = String(result.formValues[7] ?? "").trim();
  const maxStreak = String(result.formValues[8] ?? "").trim();
  const minKills = String(result.formValues[9] ?? "").trim();
  filters.minKillerKillstreak = minStreak ? Math.max(0, Math.floor(Number(minStreak))) : undefined;
  filters.maxKillerKillstreak = maxStreak ? Math.max(0, Math.floor(Number(maxStreak))) : undefined;
  filters.minKillerKills = minKills ? Math.max(0, Math.floor(Number(minKills))) : undefined;
  saveCombat();
  tell(player, "Kill rule saved.");
}

async function addKillScoreAction(player: Player, rule: KillConditionRule, current?: KillConditionScoreAction): Promise<void> {
  const operations: KillConditionScoreAction["operation"][] = ["add", "set", "remove"];
  const targets: KillConditionScoreAction["target"][] = ["killer", "victim"];
  const modal = new ModalFormData()
    .title(current ? "Edit Score Action" : "Add Score Action")
    .dropdown("Target", targets, { defaultValueIndex: Math.max(0, targets.indexOf(current?.target ?? "killer")) })
    .textField("Objective", "money", { defaultValue: current?.objective ?? "money" })
    .dropdown("Operation", operations, { defaultValueIndex: Math.max(0, operations.indexOf(current?.operation ?? "add")) })
    .textField("Amount", "100", { defaultValue: String(current?.amount ?? 100) })
    .submitButton("Save");

  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const action: KillConditionScoreAction = {
    type: "score",
    target: targets[Number(result.formValues[0] ?? 0)] ?? "killer",
    objective: String(result.formValues[1] ?? "money").trim() || "money",
    operation: operations[Number(result.formValues[2] ?? 0)] ?? "add",
    amount: Math.floor(Number(result.formValues[3] ?? 0)) || 0,
  };
  if (current) Object.assign(current, action);
  else rule.actions.push(action);
  saveCombat();
}

async function addKillCommandAction(player: Player, rule: KillConditionRule, current?: Extract<KillConditionAction, { type: "command" }>): Promise<void> {
  const modal = new ModalFormData()
    .title(current ? "Edit Command Chain" : "Add Command Chain")
    .textField("Commands separated by ;", "say {killer} killed {victim};give @s diamond 1", { defaultValue: current?.commands.join(";") ?? "" })
    .submitButton("Save");
  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;
  const commands = String(result.formValues[0] ?? "")
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
    const form = new ActionFormData().title(`Actions: ${rule.name}`).body(`Actions: ${rule.actions.length}`)
      .button("Add Score Action", ICONS.shop)
      .button("Add Command Chain", ICONS.settings);
    for (const action of rule.actions) {
      form.button(action.type === "score" ? `Score: ${action.target} ${action.operation} ${action.amount} ${action.objective}` : `Commands: ${action.commands.length}`, ICONS.edit);
    }
    form.button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 0) {
      await addKillScoreAction(player, rule);
      continue;
    }
    if (response.selection === 1) {
      await addKillCommandAction(player, rule);
      continue;
    }
    const actionIndex = response.selection - 2;
    if (actionIndex >= rule.actions.length) return;
    const action = rule.actions[actionIndex];
    const manage = new ActionFormData().title("Action").button("Edit", ICONS.edit).button("Delete", ICONS.delete).button("Back", ICONS.back);
    const picked = await manage.show(player).catch(() => undefined);
    if (!picked || picked.canceled || picked.selection === undefined || picked.selection === 2) continue;
    if (picked.selection === 1) {
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
    const form = new ActionFormData()
      .title(rule.name)
      .body(formatKillRuleLine(rule))
      .button("Edit Details/Filters", ICONS.edit)
      .button("Actions", ICONS.settings)
      .button("Duplicate", ICONS.confirm)
      .button("Delete", ICONS.delete)
      .button("Back", ICONS.back);
    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 0) await editKillConditionRuleDetails(player, rule);
    else if (response.selection === 1) await editKillConditionActions(player, rule);
    else if (response.selection === 2) {
      state.combat.config.killConditions.rules.push({ ...rule, id: `kill_${Date.now().toString(36)}`, name: `${rule.name} Copy`, filters: { ...rule.filters }, actions: rule.actions.map((action) => ({ ...action })) });
      saveCombat();
      tell(player, "Kill rule duplicated.");
    } else if (response.selection === 3) {
      state.combat.config.killConditions.rules = state.combat.config.killConditions.rules.filter((entry) => entry.id !== rule.id);
      saveCombat();
      tell(player, "Kill rule deleted.");
      return;
    } else return;
  }
}

async function showKillConditionsAdmin(player: Player): Promise<void> {
  while (true) {
    const store = state.combat.config.killConditions;
    const rules = store.rules.slice().sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
    const form = new ActionFormData()
      .title("Kill Conditions")
      .body(`Enabled: ${store.enabled ? "Yes" : "No"}\nRules: ${rules.length}`)
      .button(`Toggle: ${store.enabled ? "On" : "Off"}`, ICONS.settings)
      .button("Create Rule", ICONS.confirm);
    for (const rule of rules) form.button(formatKillRuleLine(rule), ICONS.edit);
    form.button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 0) {
      store.enabled = !store.enabled;
      saveCombat();
      continue;
    }
    if (response.selection === 1) {
      const rule = createDefaultKillConditionRule();
      store.rules.push(rule);
      saveCombat();
      await editKillConditionRule(player, rule);
      continue;
    }
    const rule = rules[response.selection - 2];
    if (!rule) return;
    await editKillConditionRule(player, rule);
  }
}

export async function showCombatSettingsAdmin(player: Player): Promise<void> {
  if (!isOperator(player)) return;
  while (true) {
    const combat = state.combat.config;
    const menu = new ActionFormData()
      .title("Combat Admin")
      .body(`Combat: ${combat.enabled ? "On" : "Off"}\nKill conditions: ${combat.killConditions.enabled ? "On" : "Off"}`)
      .button("Combat Settings", ICONS.settings)
      .button("Kill Conditions", ICONS.sidebar)
      .button("Back", ICONS.back);
    const picked = await menu.show(player).catch(() => undefined);
    if (!picked || picked.canceled || picked.selection === undefined || picked.selection === 2) return;
    if (picked.selection === 1) {
      await showKillConditionsAdmin(player);
      continue;
    }

  const modal = new ModalFormData()
    .title("Combat Settings")
    .toggle("Combat system enabled", { defaultValue: combat.enabled })
    .textField("Combat tag time (seconds)", "15", { defaultValue: String(combat.combatTimeSeconds) })
    .toggle("Announce combat logouts", { defaultValue: combat.announceLogouts })
    .toggle("Block commands while tagged", { defaultValue: combat.blockCommands })
    .textField("Enter combat message", "message", { defaultValue: combat.enterMessage })
    .textField("Exit combat message", "message", { defaultValue: combat.exitMessage })
    .textField("Logout broadcast", "Use {player}", { defaultValue: combat.logoutBroadcastMessage })
    .textField("Rejoin penalty message", "message", { defaultValue: combat.rejoinPenaltyMessage })
    .textField("Blocked command message", "message", { defaultValue: combat.blockedCommandMessage })
    .submitButton("Save");

  const result = await modal.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;

  combat.enabled = Boolean(result.formValues[0]);
  combat.combatTimeSeconds = Math.max(1, Math.floor(Number(result.formValues[1] ?? 15)));
  combat.announceLogouts = Boolean(result.formValues[2]);
  combat.blockCommands = Boolean(result.formValues[3]);
  combat.enterMessage = String(result.formValues[4] ?? combat.enterMessage).trim() || combat.enterMessage;
  combat.exitMessage = String(result.formValues[5] ?? combat.exitMessage).trim() || combat.exitMessage;
  combat.logoutBroadcastMessage = String(result.formValues[6] ?? combat.logoutBroadcastMessage).trim() || combat.logoutBroadcastMessage;
  combat.rejoinPenaltyMessage = String(result.formValues[7] ?? combat.rejoinPenaltyMessage).trim() || combat.rejoinPenaltyMessage;
  combat.blockedCommandMessage = String(result.formValues[8] ?? combat.blockedCommandMessage).trim() || combat.blockedCommandMessage;
  saveCombat();
  tell(player, "Combat settings saved.");
  }
}

async function showTeamInviteCenter(player: Player) {
  while (true) {
    const team = getPlayerTeam(player);
    if (!team) {
      tell(player, "You are not in a team.");
      return;
    }

    const online = world.getAllPlayers().filter((p) => p.id !== player.id && !team.memberPlayerIds.includes(getPlayerId(p)) && !team.invitedPlayerIds.includes(getPlayerId(p)));
    const form = new ActionFormData()
      .title(`§a${team.name} Invites§r`)
      .body(`§7Invited players: §f${team.invitedPlayerIds.length}`)
      .button("Invite Player", ICONS.binding)
      .button("Revoke Invite", ICONS.delete)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 2) return;

    if (response.selection === 0) {
      if (online.length === 0) {
        tell(player, "No online players available to invite.");
        continue;
      }
      const pick = new ActionFormData().title("Invite Player").body("Select a player to invite.");
      for (const p of online) pick.button(p.name, ICONS.menu);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= online.length) continue;
      tell(player, inviteToTeam(player, online[picked.selection]).message);
      continue;
    }

    if (response.selection === 1) {
      const invitedPlayers = team.invitedPlayerIds
        .map((memberId) => world.getAllPlayers().find((p) => getPlayerId(p) === memberId))
        .filter((p): p is Player => Boolean(p));
      if (invitedPlayers.length === 0) {
        tell(player, "No pending invites.");
        continue;
      }
      const pick = new ActionFormData().title("Revoke Invite").body("Select a player to revoke.");
      for (const p of invitedPlayers) pick.button(p.name, ICONS.delete);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= invitedPlayers.length) continue;
      tell(player, revokeTeamInvite(player, invitedPlayers[picked.selection]).message);
    }
  }
}

async function showPendingTeamInvites(player: Player) {
  while (true) {
    const playerId = getPlayerId(player);
    const invitedTeams = listTeams().filter((team) => team.invitedPlayerIds.includes(playerId));
    if (invitedTeams.length === 0) {
      tell(player, "You have no pending team invites.");
      return;
    }

    const form = new ActionFormData()
      .title("Pending Invites")
      .body(`§7You have §f${invitedTeams.length}§7 pending invite(s).`)
      .button("Accept Invite", ICONS.confirm)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 1) return;

    if (response.selection === 0) {
      const pick = new ActionFormData().title("Accept Team Invite").body("Select a team invite to accept.");
      for (const team of invitedTeams) pick.button(getTeamSummary(team), ICONS.confirm);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= invitedTeams.length) continue;
      tell(player, acceptTeamInvite(player, invitedTeams[picked.selection].id).message);
      return;
    }
  }
}

export async function showTeamMenu(player: Player) {
  while (true) {
    const team = getPlayerTeam(player);
    const playerId = getPlayerId(player);
    const invitedTeams = listTeams().filter((entry) => entry.invitedPlayerIds.includes(playerId));
    const form = new ActionFormData().title("§aTeams§r").body(team ? `§7Your team: §f${getTeamSummary(team)}` : "§7You are not in a team.§r");

    if (team) {
      form
        .button("Invite Center", ICONS.binding)
        .button("Team Members", ICONS.menu)
        .button("Team Settings", ICONS.settings)
        .button("Leave Team", ICONS.delete)
        .button("Team List", ICONS.sidebar)
        .button("Back", ICONS.back);
    } else {
      form
        .button("Create Team", ICONS.confirm)
        .button("Join Team", ICONS.menu)
        .button(invitedTeams.length > 0 ? `Pending Invites (${invitedTeams.length})` : "Pending Invites", ICONS.binding)
        .button("Team List", ICONS.sidebar)
        .button("Back", ICONS.back);
    }

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (team) {
      if (response.selection === 0) {
        await showTeamInviteCenter(player);
        continue;
      }
      if (response.selection === 1) {
        const members = team.memberPlayerIds
          .map((memberId) => world.getAllPlayers().find((p) => getPlayerId(p) === memberId)?.name ?? memberId)
          .slice(0, 20);
        for (const member of members) tell(player, `§7- §e${member}`);
        continue;
      }
      if (response.selection === 2) {
        const sub = new ActionFormData()
          .title("Team Settings")
          .body(`§7Friendly fire: §f${team.friendlyFire ? "On" : "Off"}\n§7Team plot: §f${team.teamPlotEnabled ? "On" : "Off"}`)
          .button(`Friendly Fire: ${team.friendlyFire ? "On" : "Off"}`, ICONS.settings)
          .button(`Team Plot: ${team.teamPlotEnabled ? "On" : "Off"}`, ICONS.sidebar)
          .button("Kick Member", ICONS.delete)
          .button("Disband Team", ICONS.delete)
          .button("Back", ICONS.back);
        const subResp = await sub.show(player).catch(() => undefined);
        if (!subResp || subResp.canceled || subResp.selection === undefined) continue;
        if (subResp.selection === 4) continue;
        if (subResp.selection === 0) {
          tell(player, setTeamFriendlyFire(player, !team.friendlyFire).message);
          continue;
        }
        if (subResp.selection === 1) {
          tell(player, setTeamPlotEnabled(player, !team.teamPlotEnabled).message);
          continue;
        }
        if (subResp.selection === 2) {
          const online = world.getAllPlayers().filter((p) => p.id !== player.id && team.memberPlayerIds.includes(getPlayerId(p)));
          if (online.length === 0) {
            tell(player, "No online members available.");
            continue;
          }
          const pick = new ActionFormData().title("Kick Member").body("Select a member to kick.");
          for (const p of online) pick.button(p.name, ICONS.delete);
          pick.button("Back", ICONS.back);
          const picked = await pick.show(player).catch(() => undefined);
          if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= online.length) continue;
          tell(player, kickFromTeam(player, online[picked.selection]).message);
          continue;
        }
        if (subResp.selection === 3) {
          tell(player, disbandTeam(player).message);
          continue;
        }
        continue;
      }
      if (response.selection === 3) {
        tell(player, leaveTeam(player).message);
        continue;
      }
      if (response.selection === 4) {
        const teams = listTeams();
        if (teams.length === 0) {
          tell(player, "No teams exist yet.");
          continue;
        }
        const lines = teams.slice(0, 20).map((teamEntry) => getTeamSummary(teamEntry));
        for (const line of lines) tell(player, line);
        continue;
      }
      if (response.selection === 5) return;
      return;
    }

    if (response.selection === 0) {
      const modal = new ModalFormData().title("Create Team").textField("Team name", "My Team").textField("Tag", "MT").submitButton("Create");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      tell(player, createTeam(player, String(result.formValues[0] ?? ""), String(result.formValues[1] ?? "")).message);
      continue;
    }
    if (response.selection === 1) {
      const teams = listTeams();
      if (teams.length === 0) {
        tell(player, "No teams exist yet.");
        continue;
      }
      const pick = new ActionFormData().title("Join Team").body("Select a team you were invited to.");
      for (const teamEntry of teams) pick.button(getTeamSummary(teamEntry), ICONS.menu);
      pick.button("Back", ICONS.back);
      const picked = await pick.show(player).catch(() => undefined);
      if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= teams.length) continue;
      tell(player, joinTeam(player, teams[picked.selection].id).message);
      continue;
    }
    if (response.selection === 2) {
      if (invitedTeams.length === 0) {
        tell(player, "No pending team invites.");
        continue;
      }
      await showPendingTeamInvites(player);
      continue;
    }
    if (response.selection === 3) {
      const teams = listTeams();
      if (teams.length === 0) {
        tell(player, "No teams exist yet.");
        continue;
      }
      const lines = teams.slice(0, 20).map((teamEntry) => getTeamSummary(teamEntry));
      for (const line of lines) tell(player, line);
      continue;
    }
    if (response.selection === 4) return;
  }
}

export async function showWarpMenu(player: Player) {
  if (!state.warps.config.enabled) {
    tell(player, "Warps are disabled.");
    return;
  }
  while (true) {
    const warps = listWarps();
    const form = new ActionFormData()
      .title("§dWarps§r")
      .body("§7Teleport to admin-managed warp points.§r")
      .button("Warp List", ICONS.sidebar)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 1) return;
    if (warps.length === 0) {
      tell(player, "No warps available.");
      continue;
    }

    const pick = new ActionFormData().title("Warp List").body("Select a warp.");
    for (const warp of warps) pick.button(`${warp.category}: ${warp.name}`, ICONS.sidebar);
    pick.button("Back", ICONS.back);
    const picked = await pick.show(player).catch(() => undefined);
    if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= warps.length) continue;
    const warp = warps[picked.selection];
    tell(player, teleportToWarp(player, warp.id).message);
  }
}

export async function showWarpAdminMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to manage warps.");
    return;
  }
  while (true) {
    const warps = listWarps();
    const form = new ActionFormData()
      .title("Warp Admin")
      .body("Manage cross-dimension server warps.")
      .button("Create Warp", ICONS.confirm)
      .button("Set Warp Location", ICONS.edit)
      .button("Delete Warp", ICONS.delete)
      .button("Warp List", ICONS.sidebar)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 4) return;

    if (response.selection === 0) {
      const modal = new ModalFormData().title("Create Warp").textField("Warp name", "spawn").textField("Category", "spawn").submitButton("Create");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      tell(player, createWarp(player, String(result.formValues[0] ?? ""), String(result.formValues[1] ?? "")).message);
      continue;
    }

    if (warps.length === 0) {
      tell(player, "No warps available.");
      continue;
    }

    const pick = new ActionFormData().title(response.selection === 1 ? "Set Warp Location" : "Delete Warp").body("Select a warp.");
    for (const warp of warps) pick.button(`${warp.category}: ${warp.name}`, ICONS.sidebar);
    pick.button("Back", ICONS.back);
    const picked = await pick.show(player).catch(() => undefined);
    if (!picked || picked.canceled || picked.selection === undefined || picked.selection >= warps.length) continue;
    const warp = warps[picked.selection];
    if (response.selection === 1) tell(player, setWarpLocation(player, warp.id).message);
    if (response.selection === 2) tell(player, deleteWarp(warp.id).message);
    if (response.selection === 3) {
      tell(player, `${warp.name} @ ${warp.dimensionId} (${warp.position.x}, ${warp.position.y}, ${warp.position.z})`);
    }
  }
}
