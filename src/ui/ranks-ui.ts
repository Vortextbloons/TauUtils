import { Player, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { CODE_TO_COLOR_NAME, ICONS, RANK_COLORS, RANK_COLOR_CODES } from "../types";
import { assignRank, getPlayerId, getPlayerRank, getPlayerStats, getPlayerStatsById, isOperator, normalizeKey, removeRank, saveChat, saveProfiles, saveRanks, setDefaultRank, state, tell } from "../storage";
import { iconForAction } from "../tau-ui";

export async function showRankMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "Only operators can adjust ranks.");
    return;
  }
  while (true) {
    const form = new ActionFormData()
      .title("Ranks")
      .body("Manage and assign ranks.")
      .button("Manage Ranks", ICONS.settings)
      .button("Assign Ranks", ICONS.binding)
      .button("Chat Format", ICONS.menu)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (response.selection === 0) {
      await showRankManager(player);
      continue;
    }
    if (response.selection === 1) {
      await showPlayerRankAssign(player);
      continue;
    }
    if (response.selection === 2) {
      await showChatConfig(player);
      continue;
    }
    return;
  }
}

export async function showRankEditor(player: Player, rankId: string) {
  if (!isOperator(player)) {
    tell(player, "Only operators can adjust ranks.");
    return;
  }
  const rank = state.ranks.ranks[rankId];
  if (!rank) {
    tell(player, `Rank "${rankId}" not found.`);
    return;
  }

  const colorName = CODE_TO_COLOR_NAME[rank.color] ?? "White";
  const colorIndex = RANK_COLORS.indexOf(colorName as typeof RANK_COLORS[number]);
  const colorOptions = RANK_COLORS.map((name) => `${RANK_COLOR_CODES[name]}${name}`);

  const form = new ModalFormData()
    .title(`Edit Rank: ${rank.name}`)
    .textField("Name", "Member", { defaultValue: rank.name })
    .dropdown("Color", colorOptions, { defaultValueIndex: colorIndex >= 0 ? colorIndex : 15 })
    .textField("Prefix", "[VIP]", { defaultValue: rank.prefix ?? "" })
    .textField("Suffix", "", { defaultValue: rank.suffix ?? "" })
    .slider("Priority", 0, 100, { defaultValue: rank.priority, valueStep: 1 })
    .textField("Permissions (comma-separated)", "tau.*, give", { defaultValue: rank.permissions.join(", ") })
    .textField("Chat Format (blank = global)", "[name]: [rank] [message]", { defaultValue: rank.chatFormat ?? "" })
    .submitButton("Save");

  const result = await form.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;

  rank.name = String(result.formValues[0] ?? "").trim() || rank.name;
  const selectedColorName = RANK_COLORS[Number(result.formValues[1] ?? 15)] ?? "White";
  rank.color = RANK_COLOR_CODES[selectedColorName] ?? "§f";
  rank.prefix = String(result.formValues[2] ?? "").trim() || undefined;
  rank.suffix = String(result.formValues[3] ?? "").trim() || undefined;
  rank.priority = Number(result.formValues[4] ?? 0);
  const permText = String(result.formValues[5] ?? "").trim();
  rank.permissions = permText ? permText.split(",").map((p: string) => p.trim()).filter(Boolean) : [];
  const chatFmt = String(result.formValues[6] ?? "").trim();
  rank.chatFormat = chatFmt || undefined;

  saveRanks();
  tell(player, `Rank "${rankId}" updated.`);
}

export async function showRankManager(player: Player) {
  if (!isOperator(player)) {
    tell(player, "Only operators can adjust ranks.");
    return;
  }
  while (true) {
    const rankKeys = Object.keys(state.ranks.ranks);

    const defaultId = state.ranks.defaultRankId;
    const defaultLabel = defaultId ? `Default: ${state.ranks.ranks[defaultId]?.name || defaultId}` : "No default";

    const form = new ActionFormData()
      .title("Rank Manager")
      .body(`Manage ranks for your server.\n${defaultLabel}`);

    for (const key of rankKeys) {
      const rank = state.ranks.ranks[key];
      const isDefault = key === defaultId ? " §a(default)" : "";
      form.button(`${rank.color}${rank.name}§r (priority: ${rank.priority})${isDefault}`, ICONS.settings);
    }

    form.button("§a+ Create New Rank", ICONS.confirm);
    form.button("Set Default Rank", ICONS.settings);
    form.button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (response.selection === rankKeys.length) {
      await showCreateRankForm(player);
      continue;
    }

    if (response.selection === rankKeys.length + 1) {
      const pickForm = new ActionFormData()
        .title("Set Default Rank")
        .body("Select the default rank for players without an assigned rank.");
      for (const key of rankKeys) {
        const rank = state.ranks.ranks[key];
        const isDefault = key === defaultId ? " §a(current)" : "";
        pickForm.button(`${rank.color}${rank.name}§r${isDefault}`);
      }
      pickForm.button("Back", ICONS.back);

      const pickResponse = await pickForm.show(player).catch(() => undefined);
      if (!pickResponse || pickResponse.canceled || pickResponse.selection === undefined) continue;
      if (pickResponse.selection < rankKeys.length) {
        const newDefault = rankKeys[pickResponse.selection];
        setDefaultRank(newDefault);
        tell(player, `Default rank set to "${state.ranks.ranks[newDefault]?.name}".`);
      }
      continue;
    }

    if (response.selection === rankKeys.length + 2) return;

    const selectedRank = state.ranks.ranks[rankKeys[response.selection]];
    if (!selectedRank) continue;

    const editForm = new ActionFormData()
      .title(`Rank: ${selectedRank.name}`)
      .body(`ID: ${selectedRank.id}\nPriority: ${selectedRank.id}\nPermissions: ${selectedRank.permissions.join(", ") || "none"}`)
      .button("Edit", ICONS.edit)
      .button("Delete", ICONS.delete)
      .button("Back", ICONS.back);

    const editResponse = await editForm.show(player).catch(() => undefined);
    if (!editResponse || editResponse.canceled || editResponse.selection === undefined) continue;

    if (editResponse.selection === 0) {
      await showRankEditor(player, selectedRank.id);
    } else if (editResponse.selection === 1) {
      delete state.ranks.ranks[selectedRank.id];
      for (const [pname, rid] of Object.entries(state.ranks.playerRanks)) {
        if (rid === selectedRank.id) delete state.ranks.playerRanks[pname];
      }
      saveRanks();
      tell(player, `Rank "${selectedRank.id}" deleted.`);
    }
  }
}

async function showCreateRankForm(player: Player) {
  if (!isOperator(player)) {
    tell(player, "Only operators can adjust ranks.");
    return;
  }
  const colorOptions = RANK_COLORS.map((name) => `${RANK_COLOR_CODES[name]}${name}`);

  const form = new ModalFormData()
    .title("Create New Rank")
    .textField("ID (no spaces)", "member")
    .textField("Name", "Member")
    .dropdown("Color", colorOptions, { defaultValueIndex: 15 })
    .textField("Prefix (optional)", "[VIP]")
    .textField("Suffix (optional)", "")
    .slider("Priority", 0, 100, { defaultValue: 0, valueStep: 1 })
    .textField("Permissions (comma-separated)", "tau.*, give")
    .textField("Chat Format (blank = global)", "[name]: [rank] [message]")
    .submitButton("Create");

  const result = await form.show(player).catch(() => undefined);
  if (!result || result.canceled || !result.formValues) return;

  const id = String(result.formValues[0] ?? "").trim().toLowerCase();
  if (!id) {
    tell(player, "Rank ID cannot be empty.");
    return;
  }
  if (state.ranks.ranks[id]) {
    tell(player, `Rank "${id}" already exists.`);
    return;
  }

  const permText = String(result.formValues[6] ?? "").trim();
  const chatFmt = String(result.formValues[7] ?? "").trim();

  state.ranks.ranks[id] = {
    id,
    name: String(result.formValues[1] ?? "").trim() || id,
    color: RANK_COLOR_CODES[RANK_COLORS[Number(result.formValues[2] ?? 15)] ?? "White"] ?? "§f",
    prefix: String(result.formValues[3] ?? "").trim() || undefined,
    suffix: String(result.formValues[4] ?? "").trim() || undefined,
    priority: Number(result.formValues[5] ?? 0),
    permissions: permText ? permText.split(",").map((p: string) => p.trim()).filter(Boolean) : [],
    chatFormat: chatFmt || undefined,
  };

  saveRanks();
  tell(player, `Rank "${id}" created.`);
}

export async function showPlayerRankAssign(player: Player) {
  if (!isOperator(player)) {
    tell(player, "Only operators can adjust ranks.");
    return;
  }
  while (true) {
    const onlinePlayers = world.getAllPlayers();
    const rankKeys = Object.keys(state.ranks.ranks);

    if (rankKeys.length === 0) {
      tell(player, "No ranks exist. Create one first.");
      return;
    }

    const form = new ActionFormData()
      .title("Assign Rank")
      .body("Select a player to assign a rank to.");

    for (const p of onlinePlayers) {
      const currentRank = state.ranks.playerRanks[p.name];
      const rankName = currentRank ? state.ranks.ranks[currentRank]?.name : "None";
      form.button(`${p.name} (${rankName})`);
    }

    form.button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (response.selection === onlinePlayers.length) return;

    const selectedPlayer = onlinePlayers[response.selection];
    if (!selectedPlayer) continue;

    const rankForm = new ActionFormData()
      .title(`Assign Rank to ${selectedPlayer.name}`)
      .body("Select a rank to assign.");

    for (const key of rankKeys) {
      const rank = state.ranks.ranks[key];
      rankForm.button(`${rank.color}${rank.name}§r`);
    }

    rankForm.button("Remove Rank", ICONS.delete);
    rankForm.button("Back", ICONS.back);

    const rankResponse = await rankForm.show(player).catch(() => undefined);
    if (!rankResponse || rankResponse.canceled || rankResponse.selection === undefined) continue;

    if (rankResponse.selection === rankKeys.length) {
      removeRank(selectedPlayer.name);
      tell(player, `Removed rank from ${selectedPlayer.name}.`);
      continue;
    }

    if (rankResponse.selection === rankKeys.length + 1) continue;

    const selectedRank = state.ranks.ranks[rankKeys[rankResponse.selection]];
    if (!selectedRank) continue;

    assignRank(selectedPlayer.name, selectedRank.id);
    tell(player, `Assigned ${selectedRank.color}${selectedRank.name}§r to ${selectedPlayer.name}.`);
  }
}

export async function showChatConfig(player: Player) {
  while (true) {
    const form = new ModalFormData()
      .title("Chat Format Config")
      .toggle("Enable Chat Formatting", { defaultValue: state.chat.enabled })
      .textField("Template", "[name]: [rank] [message]", { defaultValue: state.chat.template })
      .submitButton("Save");

    const result = await form.show(player).catch(() => undefined);
    if (!result || result.canceled || result.formValues === undefined) return;

    state.chat.enabled = Boolean(result.formValues[0]);
    state.chat.template = String(result.formValues[1] ?? "").trim() || "[name]: [rank] [message]";
    saveChat();

    const preview = state.chat.template
      .replace("[name]", player.name)
      .replace("[rank]", "§aMember§r")
      .replace("[message]", "Hello world!");

    tell(player, `Chat format saved. Preview: ${preview}`);
    return;
  }
}

export async function showProfileBrowser(player: Player) {
  while (true) {
    const form = new ActionFormData()
      .title("Player Profiles")
      .body("Select an online player to view their profile.");

    for (const online of world.getAllPlayers()) {
      form.button(online.name, ICONS.menu);
    }

    form.button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection >= world.getAllPlayers().length) return;

    const selected = world.getAllPlayers()[response.selection];
    if (!selected) continue;
    await showPlayerProfileViewer(player, selected.name);
  }
}

export async function showPlayerProfileViewer(player: Player | undefined, targetName: string) {
  const target = world.getAllPlayers().find((entry) => entry.name.toLowerCase() === targetName.toLowerCase());
  const profileId = target ? getPlayerId(target) : `tau-lookup-${normalizeKey(targetName)}`;
  const stats = target ? getPlayerStats(target) : getPlayerStatsById(profileId);
  const profile = state.profiles.configs[profileId] ?? { enabled: true, sections: ["summary", "stats", "rank"], customFields: [] };
  const rank = target ? getPlayerRank(target.name) : undefined;

  const lines: string[] = [];
  if (profile.sections.includes("summary")) {
    lines.push(`§ePlayer: §f${target?.name ?? targetName}`);
    lines.push(`§eOnline: §f${target ? "Yes" : "No"}`);
  }
  if (profile.sections.includes("rank")) {
    lines.push(`§eRank: §f${rank ? `${rank.color}${rank.name}§r` : "None"}`);
  }
  if (profile.sections.includes("stats")) {
    lines.push(`§eKills: §f${stats.kills}`);
    lines.push(`§eDeaths: §f${stats.deaths}`);
    lines.push(`§eKillstreak: §f${stats.killstreak}`);
    lines.push(`§eBest Streak: §f${stats.longestKillstreak}`);
    lines.push(`§eBlocks Placed: §f${stats.blocksPlaced}`);
    lines.push(`§eBlocks Broken: §f${stats.blocksBroken}`);
    lines.push(`§eTime Played: §f${stats.timePlayed}`);
    lines.push(`§eDistance: §f${Math.floor(stats.distanceTraveled)}`);
  }
  for (const field of profile.customFields) {
    lines.push(`§e${field}`);
  }

  if (player) {
    const form = new ActionFormData()
      .title(`Profile: ${target?.name ?? targetName}`)
      .body(lines.join("\n") || "No profile data.")
      .button("Close", ICONS.back);
    await form.show(player).catch(() => undefined);
  }
}

export async function showPlayerProfileEditor(player: Player, targetName: string) {
  const target = world.getAllPlayers().find((entry) => entry.name.toLowerCase() === targetName.toLowerCase());
  if (!target) {
    tell(player, "That player is not online.");
    return;
  }

  const profileId = getPlayerId(target);
  const existing = state.profiles.configs[profileId] ?? { enabled: true, sections: ["summary", "stats", "rank"], customFields: [] };

  while (true) {
    const form = new ActionFormData()
      .title(`Edit Profile: ${target.name}`)
      .body("Choose what this player profile shows.")
      .button(`Summary: ${existing.sections.includes("summary") ? "On" : "Off"}`)
      .button(`Stats: ${existing.sections.includes("stats") ? "On" : "Off"}`)
      .button(`Rank: ${existing.sections.includes("rank") ? "On" : "Off"}`)
      .button(`Custom: ${existing.sections.includes("custom") ? "On" : "Off"}`)
      .button("Save", ICONS.confirm)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (response.selection === 0) {
      toggleSection(existing, "summary");
      continue;
    }
    if (response.selection === 1) {
      toggleSection(existing, "stats");
      continue;
    }
    if (response.selection === 2) {
      toggleSection(existing, "rank");
      continue;
    }
    if (response.selection === 3) {
      toggleSection(existing, "custom");
      continue;
    }
    if (response.selection === 4) {
      state.profiles.configs[profileId] = existing;
      saveProfiles();
      tell(player, `Profile settings saved for ${target.name}.`);
      return;
    }
    return;
  }
}

function toggleSection(profile: { sections: string[] }, section: string) {
  const index = profile.sections.indexOf(section);
  if (index >= 0) profile.sections.splice(index, 1);
  else profile.sections.push(section);
}
