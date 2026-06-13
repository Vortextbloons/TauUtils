import { Player } from "@minecraft/server";
import { TauUi } from "./tau-ui";
import { ICONS, type ClaimAnnouncementTarget, type ClaimDefinition } from "../types";
import { getPlayerId, isOperator, normalizeKey, saveClaims, state, tell } from "../storage";
import { commitClaim, invalidateClaimRuntimeState, normalizeClaimBounds } from "../claims";
import { getPlayerTeam } from "../teams";

function copyClaim(claim: ClaimDefinition): ClaimDefinition {
  return { ...claim, min: { ...claim.min }, max: { ...claim.max }, flags: { ...claim.flags }, members: { ...claim.members }, trustedTeams: { ...claim.trustedTeams } };
}

function playerClaims(player: Player): ClaimDefinition[] {
  const id = getPlayerId(player);
  return Object.values(state.claims.claims).filter((claim) => claim.ownerPlayerId === id).sort((a, b) => a.name.localeCompare(b.name));
}

function coords(claim: ClaimDefinition): string {
  return `${claim.min.x} ${claim.min.y} ${claim.min.z} -> ${claim.max.x} ${claim.max.y} ${claim.max.z}`;
}

function parseCoords(raw: string): number[] | undefined {
  const values = raw.trim().split(/[\s,]+/).map((entry) => Number(entry));
  return values.length === 6 && values.every(Number.isFinite) ? values : undefined;
}

function makeClaim(player: Player, id: string, name: string, values: number[]): ClaimDefinition {
  const bounds = normalizeClaimBounds({ x: values[0]!, y: values[1]!, z: values[2]! }, { x: values[3]!, y: values[4]!, z: values[5]! });
  const playerId = getPlayerId(player);
  const team = getPlayerTeam(player);
  const now = Date.now();
  return {
    id,
    name,
    enabled: true,
    ownerPlayerId: playerId,
    ownerName: player.name,
    teamId: team?.id,
    dimensionId: player.dimension.id,
    min: bounds.min,
    max: bounds.max,
    createdAt: now,
    updatedAt: now,
    priority: 0,
    flags: { ...state.claims.config.defaultFlags },
    members: {},
    trustedTeams: {},
    announceEnter: true,
    announceLeave: false,
    announcementTarget: "player",
  };
}

async function createClaim(player: Player): Promise<void> {
  const loc = player.location;
  const defaultCoords = `${Math.floor(loc.x - 4)} ${Math.floor(loc.y - 1)} ${Math.floor(loc.z - 4)} ${Math.floor(loc.x + 4)} ${Math.floor(loc.y + 4)} ${Math.floor(loc.z + 4)}`;
  const result = await TauUi.modal("Create Claim")
    .text("id", "Claim ID", { placeholder: "home_base" })
    .text("name", "Name", { placeholder: "Home Base" })
    .text("coords", "3D coords: x1 y1 z1 x2 y2 z2", { defaultValue: defaultCoords })
    .submitButton("Create")
    .show(player);
  if (result.canceled) return;
  const id = normalizeKey(String(result.values.id ?? ""));
  if (!id || state.claims.claims[id]) {
    tell(player, "Invalid or duplicate claim ID.");
    return;
  }
  const values = parseCoords(String(result.values.coords ?? ""));
  if (!values) {
    tell(player, "Enter 6 valid coordinates.");
    return;
  }
  const claim = makeClaim(player, id, String(result.values.name ?? id).trim() || id, values);
  const saved = commitClaim(claim);
  tell(player, `${saved.ok ? "§a" : "§c"}${saved.message}`);
}

async function editClaim(player: Player, claimId: string): Promise<void> {
  const claim = state.claims.claims[claimId];
  if (!claim) return;
  while (true) {
    const response = await TauUi.action(`Claim: ${claim.name}`)
      .body(`Coords: ${coords(claim)}\nProtection: ${claim.flags.protectionEnabled ? "On" : "Off"}\nEnter announce: ${claim.announceEnter ? "On" : "Off"}`)
      .button("settings", "Settings", { iconPath: ICONS.edit })
      .button("messages", "Announcements", { iconPath: ICONS.sidebar })
      .button("delete", "Delete", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back })
      .show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "delete") {
      const ok = await TauUi.confirm(player, { title: "Delete Claim", body: `Delete ${claim.name}?`, confirmText: "Delete" });
      if (!ok) continue;
      delete state.claims.claims[claim.id];
      saveClaims();
      invalidateClaimRuntimeState();
      tell(player, "Claim deleted.");
      return;
    }
    if (response.id === "settings") {
      const editable = state.claims.config.playerEditableFlags;
      const result = await TauUi.modal("Claim Settings")
        .text("name", "Name", { defaultValue: claim.name })
        .toggle("protectionEnabled", "Protection enabled", claim.flags.protectionEnabled)
        .toggle("blockBreak", "Allow public block breaking", claim.flags.blockBreak)
        .toggle("blockPlace", "Allow public block placing", claim.flags.blockPlace)
        .toggle("itemUse", "Allow public item use", claim.flags.itemUse)
        .toggle("entityInteract", "Allow public entity interact", claim.flags.entityInteract)
        .toggle("pvp", "Allow PvP", claim.flags.pvp)
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const next = copyClaim(claim);
      next.name = String(result.values.name ?? claim.name).trim() || claim.name;
      for (const key of ["protectionEnabled", "blockBreak", "blockPlace", "itemUse", "entityInteract", "pvp"] as const) {
        if (editable[key]) next.flags[key] = Boolean(result.values[key]);
      }
      const saved = commitClaim(next);
      tell(player, `${saved.ok ? "§a" : "§c"}${saved.message}`);
      return;
    }
    if (response.id === "messages") {
      const targets: ClaimAnnouncementTarget[] = state.claims.config.announcementTargets.length > 0 ? state.claims.config.announcementTargets : ["player"];
      const targetIndex = Math.max(0, targets.indexOf(claim.announcementTarget));
      const result = await TauUi.modal("Claim Announcements")
        .toggle("announceEnter", "Announce enter", claim.announceEnter)
        .toggle("announceLeave", "Announce leave", claim.announceLeave)
        .dropdown("target", "Who gets announcements", targets, targetIndex)
        .text("enterMessage", "Enter message", { defaultValue: claim.enterMessage ?? "Entering [claim]" })
        .text("leaveMessage", "Leave message", { defaultValue: claim.leaveMessage ?? "Leaving [claim]" })
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      const next = copyClaim(claim);
      next.announceEnter = Boolean(result.values.announceEnter);
      next.announceLeave = Boolean(result.values.announceLeave);
      next.announcementTarget = targets[Math.max(0, Number(result.values.target ?? 0))] ?? "player";
      next.enterMessage = String(result.values.enterMessage ?? "").trim() || undefined;
      next.leaveMessage = String(result.values.leaveMessage ?? "").trim() || undefined;
      const saved = commitClaim(next);
      tell(player, `${saved.ok ? "§a" : "§c"}${saved.message}`);
      return;
    }
  }
}

export async function showClaimMenu(player: Player): Promise<void> {
  if (!state.claims.config.enabled) {
    tell(player, "Claims are disabled.");
    return;
  }
  while (true) {
    const form = TauUi.action<{ claimId: string }>("Claims").button("create", "Create Claim", { iconPath: ICONS.confirm });
    for (const claim of playerClaims(player)) form.button("claim", claim.name, { iconPath: ICONS.plot, value: { claimId: claim.id } });
    form.button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "create") await createClaim(player);
    if (response.id === "claim" && response.value) await editClaim(player, response.value.claimId);
  }
}

export async function showClaimsAdminMenu(player: Player): Promise<void> {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit claims.");
    return;
  }
  const cfg = state.claims.config;
  const result = await TauUi.modal("Claims Admin")
    .toggle("enabled", "Enabled", cfg.enabled)
    .toggle("protectionEnabled", "Protection system enabled", cfg.protectionEnabled)
    .toggle("allowPlayersToToggleProtection", "Players can toggle protection", cfg.allowPlayersToToggleProtection)
    .text("maxClaimsPerPlayer", "Max claims per player", { defaultValue: String(cfg.maxClaimsPerPlayer) })
    .text("maxClaimsPerTeam", "Max claims per team", { defaultValue: String(cfg.maxClaimsPerTeam) })
    .text("maxSize", "Max 3D size x y z", { defaultValue: `${cfg.maxClaimSize.x} ${cfg.maxClaimSize.y} ${cfg.maxClaimSize.z}` })
    .text("maxClaimVolume", "Max claim volume", { defaultValue: String(cfg.maxClaimVolume) })
    .toggle("allowOverlaps", "Allow overlaps", cfg.allowOverlaps)
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const maxSize = String(result.values.maxSize ?? "").trim().split(/[\s,]+/).map((entry) => Number(entry));
  cfg.enabled = Boolean(result.values.enabled);
  cfg.protectionEnabled = Boolean(result.values.protectionEnabled);
  cfg.allowPlayersToToggleProtection = Boolean(result.values.allowPlayersToToggleProtection);
  cfg.maxClaimsPerPlayer = Math.max(0, Math.floor(Number(result.values.maxClaimsPerPlayer ?? cfg.maxClaimsPerPlayer)));
  cfg.maxClaimsPerTeam = Math.max(0, Math.floor(Number(result.values.maxClaimsPerTeam ?? cfg.maxClaimsPerTeam)));
  if (maxSize.length === 3 && maxSize.every(Number.isFinite)) cfg.maxClaimSize = { x: Math.max(1, Math.floor(maxSize[0]!)), y: Math.max(1, Math.floor(maxSize[1]!)), z: Math.max(1, Math.floor(maxSize[2]!)) };
  cfg.maxClaimVolume = Math.max(1, Math.floor(Number(result.values.maxClaimVolume ?? cfg.maxClaimVolume)));
  cfg.allowOverlaps = Boolean(result.values.allowOverlaps);
  saveClaims();
  invalidateClaimRuntimeState();
  tell(player, "Claims admin settings saved.");
}
