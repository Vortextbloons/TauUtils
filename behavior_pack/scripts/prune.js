import { state, savePrune, saveProfiles, saveStats, saveTeams, savePlots, saveHomes, savePlayerSettings, tell } from "./storage";
function chunkDetails(details, chunkSize = 6) {
    const chunks = [];
    for (let index = 0; index < details.length; index += chunkSize) {
        chunks.push(details.slice(index, index + chunkSize).join(", "));
    }
    return chunks;
}
export function tellPruneResult(player, result, dryRun) {
    const action = dryRun ? "Preview" : "Pruned";
    tell(player, `${action}: ${result.removed} entries ${dryRun ? "would be removed" : "removed"}.`);
    if (result.details.length === 0) {
        tell(player, "No matching entries.");
        return;
    }
    for (const line of chunkDetails(result.details)) {
        tell(player, `§7- ${line}`);
    }
}
function cutoffMs() {
    const days = Math.max(1, Math.floor(state.prune.config.inactiveDays));
    return Date.now() - days * 24 * 60 * 60 * 1000;
}
function isInactive(playerId) {
    const stats = state.stats.players[playerId];
    if (!stats)
        return true;
    return (stats.lastSeenAt ?? 0) < cutoffMs();
}
export function pruneData(dryRun = true) {
    const details = [];
    let removed = 0;
    const cutoff = cutoffMs();
    const prune = state.prune.config.flags;
    if (prune.stats) {
        for (const [playerId, stats] of Object.entries(state.stats.players)) {
            if ((stats.lastSeenAt ?? 0) < cutoff) {
                removed += 1;
                details.push(`stats:${playerId}`);
                if (!dryRun)
                    delete state.stats.players[playerId];
            }
        }
        if (!dryRun)
            saveStats();
    }
    if (prune.profiles) {
        for (const [playerId, cfg] of Object.entries(state.profiles.configs)) {
            if (isInactive(playerId) && cfg.sections.length === 0 && cfg.customFields.length === 0) {
                removed += 1;
                details.push(`profiles:${playerId}`);
                if (!dryRun)
                    delete state.profiles.configs[playerId];
            }
        }
        if (!dryRun)
            saveProfiles();
    }
    if (prune.teams) {
        for (const [teamId, team] of Object.entries(state.teams.teams)) {
            if (team.memberPlayerIds.length === 0 || (team.memberPlayerIds.length === 1 && team.ownerPlayerId)) {
                removed += 1;
                details.push(`teams:${teamId}`);
                if (!dryRun)
                    delete state.teams.teams[teamId];
            }
        }
        if (!dryRun)
            saveTeams();
    }
    if (prune.plots) {
        for (const [playerId, slotId] of Object.entries(state.plots.playerToSlot)) {
            if (isInactive(playerId)) {
                removed += 1;
                details.push(`plots:${slotId}`);
                if (!dryRun) {
                    delete state.plots.playerToSlot[playerId];
                    const slot = state.plots.slots[slotId];
                    if (slot)
                        slot.occupiedByPlayerId = undefined;
                }
            }
        }
        if (!dryRun)
            savePlots();
    }
    if (prune.homes) {
        for (const [playerId, homes] of Object.entries(state.homes.homesByPlayerId)) {
            if (isInactive(playerId)) {
                removed += 1;
                details.push(`homes:${playerId}`);
                if (!dryRun)
                    delete state.homes.homesByPlayerId[playerId];
            }
            else if (Object.keys(homes).length === 0) {
                removed += 1;
                details.push(`homes:${playerId}:empty`);
                if (!dryRun)
                    delete state.homes.homesByPlayerId[playerId];
            }
        }
        if (!dryRun)
            saveHomes();
    }
    if (prune.playerSettings) {
        for (const [playerId, settings] of Object.entries(state.playerSettings.players)) {
            if (isInactive(playerId) && settings.allowPay && settings.allowTpa && settings.showSocialMessages) {
                removed += 1;
                details.push(`playerSettings:${playerId}`);
                if (!dryRun)
                    delete state.playerSettings.players[playerId];
            }
        }
        if (!dryRun)
            savePlayerSettings();
    }
    if (prune.tpa || prune.pay) {
        // Social config is retained; only the prune flags are being toggled.
    }
    if (!dryRun)
        savePrune();
    return { removed, details };
}
