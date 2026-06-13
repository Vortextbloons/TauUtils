import { Player, world } from "@minecraft/server";
import { CODE_TO_COLOR_NAME, ICONS, RANK_COLORS, RANK_COLOR_CODES } from "../types";
import { assignRank, getPlayerId, getPlayerRank, getPlayerStats, getPlayerStatsById, isOperator, normalizeKey, removeRank, saveChat, saveProfiles, saveRanks, setDefaultRank, state, tell } from "../storage";
import { TauUi } from "./tau-ui";

export async function showRankMenu(player: Player) {
  if (!isOperator(player)) {
    tell(player, "Only operators can adjust ranks.");
    return;
  }
  while (true) {
    const res = await TauUi.action("Ranks")
      .body("Manage and assign ranks.")
      .button("manage", "Manage Ranks", { iconPath: ICONS.settings })
      .button("assign", "Assign Ranks", { iconPath: ICONS.binding })
      .button("chat", "Chat Format", { iconPath: ICONS.menu })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);

    if (TauUi.isCanceledOrBack(res)) return;

    if (res.id === "manage") {
      await showRankManager(player);
      continue;
    }
    if (res.id === "assign") {
      await showPlayerRankAssign(player);
      continue;
    }
    if (res.id === "chat") {
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

  const result = await TauUi.modal(`Edit Rank: ${rank.name}`)
    .text("name", "Name", { placeholder: "Member", defaultValue: rank.name })
    .dropdown("color", "Color", colorOptions, colorIndex >= 0 ? colorIndex : 15)
    .text("prefix", "Prefix", { placeholder: "[VIP]", defaultValue: rank.prefix ?? "" })
    .text("suffix", "Suffix", { placeholder: "", defaultValue: rank.suffix ?? "" })
    .slider("priority", "Priority", 0, 100, { step: 1, defaultValue: rank.priority })
    .text("permissions", "Permissions (comma-separated)", { placeholder: "tau.*, give", defaultValue: rank.permissions.join(", ") })
    .text("chatFormat", "Chat Format (blank = global)", { placeholder: "[name]: [rank] [message]", defaultValue: rank.chatFormat ?? "" })
    .submitButton("Save")
    .show(player);

  if (result.canceled) return;

  rank.name = String(result.values.name ?? "").trim() || rank.name;
  const selectedColorName = RANK_COLORS[Number(result.values.color ?? 15)] ?? "White";
  rank.color = RANK_COLOR_CODES[selectedColorName] ?? "§f";
  rank.prefix = String(result.values.prefix ?? "").trim() || undefined;
  rank.suffix = String(result.values.suffix ?? "").trim() || undefined;
  rank.priority = Number(result.values.priority ?? 0);
  const permText = String(result.values.permissions ?? "").trim();
  rank.permissions = permText ? permText.split(",").map((p: string) => p.trim()).filter(Boolean) : [];
  const chatFmt = String(result.values.chatFormat ?? "").trim();
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

    const form = TauUi.action("Rank Manager")
      .body(`Manage ranks for your server.\n${defaultLabel}`);

    for (const key of rankKeys) {
      const rank = state.ranks.ranks[key];
      const isDefault = key === defaultId ? " §a(default)" : "";
      form.button(`rank_${key}`, `${rank.color}${rank.name}§r (priority: ${rank.priority})${isDefault}`, { iconPath: ICONS.settings });
    }

    form.button("create", "§a+ Create New Rank", { iconPath: ICONS.confirm });
    form.button("setDefault", "Set Default Rank", { iconPath: ICONS.settings });
    form.button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled) return;

    if (response.id === "create") {
      await showCreateRankForm(player);
      continue;
    }

    if (response.id === "setDefault") {
      const pickForm = TauUi.action("Set Default Rank")
        .body("Select the default rank for players without an assigned rank.");
      for (const key of rankKeys) {
        const rank = state.ranks.ranks[key];
        const isDefault = key === defaultId ? " §a(current)" : "";
        pickForm.button(`rank_${key}`, `${rank.color}${rank.name}§r${isDefault}`);
      }
      pickForm.button("back", "Back", { iconPath: ICONS.back });

      const pickResponse = await pickForm.show(player);
      if (TauUi.isCanceledOrBack(pickResponse)) continue;
      const newDefault = (pickResponse.id as string).replace("rank_", "");
      setDefaultRank(newDefault);
      tell(player, `Default rank set to "${state.ranks.ranks[newDefault]?.name}".`);
      continue;
    }

    if (response.id === "back") return;

    const selectedRank = state.ranks.ranks[response.id.replace("rank_", "")];
    if (!selectedRank) continue;

    const editForm = TauUi.action(`Rank: ${selectedRank.name}`)
      .body(`ID: ${selectedRank.id}\nPriority: ${selectedRank.id}\nPermissions: ${selectedRank.permissions.join(", ") || "none"}`)
      .button("edit", "Edit", { iconPath: ICONS.edit })
      .button("delete", "Delete", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back });

    const editResponse = await editForm.show(player);
    if (TauUi.isCanceledOrBack(editResponse)) continue;

    if (editResponse.id === "edit") {
      await showRankEditor(player, selectedRank.id);
    } else if (editResponse.id === "delete") {
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

  const result = await TauUi.modal("Create New Rank")
    .text("id", "ID (no spaces)", { placeholder: "member" })
    .text("name", "Name", { placeholder: "Member" })
    .dropdown("color", "Color", colorOptions, 15)
    .text("prefix", "Prefix (optional)", { placeholder: "[VIP]" })
    .text("suffix", "Suffix (optional)", { placeholder: "" })
    .slider("priority", "Priority", 0, 100, { step: 1, defaultValue: 0 })
    .text("permissions", "Permissions (comma-separated)", { placeholder: "tau.*, give" })
    .text("chatFormat", "Chat Format (blank = global)", { placeholder: "[name]: [rank] [message]" })
    .submitButton("Create")
    .show(player);

  if (result.canceled) return;

  const id = String(result.values.id ?? "").trim().toLowerCase();
  if (!id) {
    tell(player, "Rank ID cannot be empty.");
    return;
  }
  if (state.ranks.ranks[id]) {
    tell(player, `Rank "${id}" already exists.`);
    return;
  }

  const permText = String(result.values.permissions ?? "").trim();
  const chatFmt = String(result.values.chatFormat ?? "").trim();

  state.ranks.ranks[id] = {
    id,
    name: String(result.values.name ?? "").trim() || id,
    color: RANK_COLOR_CODES[RANK_COLORS[Number(result.values.color ?? 15)] ?? "White"] ?? "§f",
    prefix: String(result.values.prefix ?? "").trim() || undefined,
    suffix: String(result.values.suffix ?? "").trim() || undefined,
    priority: Number(result.values.priority ?? 0),
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

    const form = TauUi.action("Assign Rank")
      .body("Select a player to assign a rank to.");

    for (const p of onlinePlayers) {
      const currentRank = state.ranks.playerRanks[p.name];
      const rankName = currentRank ? state.ranks.ranks[currentRank]?.name : "None";
      form.button(`player_${p.name}`, `${p.name} (${rankName})`);
    }

    form.button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (TauUi.isCanceledOrBack(response)) return;

    const selectedPlayerName = (response.id as string).replace("player_", "");
    const selectedPlayer = onlinePlayers.find((p) => p.name === selectedPlayerName);
    if (!selectedPlayer) continue;

    const rankForm = TauUi.action(`Assign Rank to ${selectedPlayer.name}`)
      .body("Select a rank to assign.");

    for (const key of rankKeys) {
      const rank = state.ranks.ranks[key];
      rankForm.button(`rank_${key}`, `${rank.color}${rank.name}§r`);
    }

    rankForm.button("remove", "Remove Rank", { iconPath: ICONS.delete });
    rankForm.button("back", "Back", { iconPath: ICONS.back });

    const rankResponse = await rankForm.show(player);
    if (TauUi.isCanceledOrBack(rankResponse)) continue;

    if (rankResponse.id === "remove") {
      removeRank(selectedPlayer.name);
      tell(player, `Removed rank from ${selectedPlayer.name}.`);
      continue;
    }

    const selectedRankKey = (rankResponse.id as string).replace("rank_", "");
    const selectedRank = state.ranks.ranks[selectedRankKey];
    if (!selectedRank) continue;

    assignRank(selectedPlayer.name, selectedRank.id);
    tell(player, `Assigned ${selectedRank.color}${selectedRank.name}§r to ${selectedPlayer.name}.`);
  }
}

export async function showChatConfig(player: Player) {
  while (true) {
    const result = await TauUi.modal("Chat Format Config")
      .toggle("enabled", "Enable Chat Formatting", state.chat.enabled)
      .text("template", "Template", { placeholder: "[name]: [rank] [message]", defaultValue: state.chat.template })
      .submitButton("Save")
      .show(player);

    if (result.canceled) return;

    state.chat.enabled = Boolean(result.values.enabled);
    state.chat.template = String(result.values.template ?? "").trim() || "[name]: [rank] [message]";
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
    const players = world.getAllPlayers();
    const form = TauUi.action("Player Profiles")
      .body("Select an online player to view their profile.");

    for (const online of players) {
      form.button(`player_${online.name}`, online.name, { iconPath: ICONS.menu });
    }

    form.button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (TauUi.isCanceledOrBack(response)) return;

    const selected = players.find((p) => p.name === (response.id as string).replace("player_", ""));
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
    await TauUi.action(`Profile: ${target?.name ?? targetName}`)
      .body(lines.join("\n") || "No profile data.")
      .button("close", "Close", { iconPath: ICONS.back })
      .show(player);
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
    const form = TauUi.action(`Edit Profile: ${target.name}`)
      .body("Choose what this player profile shows.")
      .button("summary", `Summary: ${existing.sections.includes("summary") ? "On" : "Off"}`)
      .button("stats", `Stats: ${existing.sections.includes("stats") ? "On" : "Off"}`)
      .button("rank", `Rank: ${existing.sections.includes("rank") ? "On" : "Off"}`)
      .button("custom", `Custom: ${existing.sections.includes("custom") ? "On" : "Off"}`)
      .button("save", "Save", { iconPath: ICONS.confirm })
      .button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (TauUi.isCanceledOrBack(response)) return;

    if (response.id === "summary") {
      toggleSection(existing, "summary");
      continue;
    }
    if (response.id === "stats") {
      toggleSection(existing, "stats");
      continue;
    }
    if (response.id === "rank") {
      toggleSection(existing, "rank");
      continue;
    }
    if (response.id === "custom") {
      toggleSection(existing, "custom");
      continue;
    }
    if (response.id === "save") {
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
