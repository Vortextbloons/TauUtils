import { Player } from "@minecraft/server";
import { TauUi } from "./tau-ui";
import { ICONS, type RtpRegion } from "../types";
import { isOperator, normalizeKey, saveRtp, state, tell } from "../storage";
import { commitRtpRegion, listRtpRegions, normalizeRtpBounds, randomTeleport } from "../rtp";

function parseCoords(raw: string): number[] | undefined {
  const values = raw.trim().split(/[\s,]+/).map((entry) => Number(entry));
  return values.length === 4 && values.every(Number.isFinite) ? values : undefined;
}

function defaultRegion(player: Player, id: string, name: string, values: number[]): RtpRegion {
  const bounds = normalizeRtpBounds({ x: values[0]!, y: -64, z: values[1]! }, { x: values[2]!, y: 320, z: values[3]! });
  return {
    id,
    name,
    enabled: true,
    dimensionId: player.dimension.id,
    min: bounds.min,
    max: bounds.max,
    priority: 0,
    allowedRanks: [],
    cooldownSeconds: state.rtp.config.cooldownSeconds,
    fallFromSky: true,
    skyHeightOffset: state.rtp.config.defaultSkyHeightOffset,
    safeLanding: true,
    maxAttempts: state.rtp.config.maxAttempts,
    avoidClaims: state.rtp.config.avoidClaims,
    avoidCustomAreas: state.rtp.config.avoidCustomAreas,
    protection: { ...state.rtp.config.defaultProtection },
  };
}

async function createRegion(player: Player): Promise<void> {
  const loc = player.location;
  const defaultCoords = `${Math.floor(loc.x - 500)} ${Math.floor(loc.z - 500)} ${Math.floor(loc.x + 500)} ${Math.floor(loc.z + 500)}`;
  const result = await TauUi.modal("Create RTP Region")
    .text("id", "Region ID", { placeholder: "wild" })
    .text("name", "Name", { placeholder: "Wild" })
    .text("coords", "XZ bounds: x1 z1 x2 z2", { defaultValue: defaultCoords })
    .submitButton("Create")
    .show(player);
  if (result.canceled) return;
  const id = normalizeKey(String(result.values.id ?? ""));
  const coords = parseCoords(String(result.values.coords ?? ""));
  if (!id || state.rtp.regions[id]) {
    tell(player, "Invalid or duplicate region ID.");
    return;
  }
  if (!coords) {
    tell(player, "Enter 4 valid coordinates: x1 z1 x2 z2.");
    return;
  }
  tell(player, commitRtpRegion(defaultRegion(player, id, String(result.values.name ?? id).trim() || id, coords)).message);
}

async function editRegion(player: Player, region: RtpRegion): Promise<void> {
  const result = await TauUi.modal(`RTP: ${region.name}`)
    .text("name", "Name", { defaultValue: region.name })
    .toggle("enabled", "Enabled", region.enabled)
    .text("coords", "XZ bounds: x1 z1 x2 z2", { defaultValue: `${region.min.x} ${region.min.z} ${region.max.x} ${region.max.z}` })
    .text("cooldown", "Cooldown seconds", { defaultValue: String(region.cooldownSeconds ?? state.rtp.config.cooldownSeconds) })
    .text("skyHeightOffset", "Sky height offset", { defaultValue: String(region.skyHeightOffset) })
    .toggle("avoidClaims", "Avoid claims", region.avoidClaims)
    .toggle("avoidCustomAreas", "Avoid custom areas", region.avoidCustomAreas)
    .text("protectionSeconds", "Protection seconds", { defaultValue: String(region.protection.durationSeconds) })
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  const coords = parseCoords(String(result.values.coords ?? ""));
  if (!coords) {
    tell(player, "Enter 4 valid coordinates: x1 z1 x2 z2.");
    return;
  }
  const bounds = normalizeRtpBounds({ x: coords[0]!, y: -64, z: coords[1]! }, { x: coords[2]!, y: 320, z: coords[3]! });
  region.name = String(result.values.name ?? region.name).trim() || region.name;
  region.enabled = Boolean(result.values.enabled);
  region.min = bounds.min;
  region.max = bounds.max;
  region.cooldownSeconds = Math.max(0, Math.floor(Number(result.values.cooldown ?? state.rtp.config.cooldownSeconds)));
  region.fallFromSky = true;
  region.skyHeightOffset = Math.max(1, Math.floor(Number(result.values.skyHeightOffset ?? region.skyHeightOffset)));
  region.avoidClaims = Boolean(result.values.avoidClaims);
  region.avoidCustomAreas = Boolean(result.values.avoidCustomAreas);
  region.protection.durationSeconds = Math.max(1, Math.floor(Number(result.values.protectionSeconds ?? region.protection.durationSeconds)));
  tell(player, commitRtpRegion(region).message);
}

export async function showRtpMenu(player: Player): Promise<void> {
  const regions = listRtpRegions(player);
  if (regions.length === 0) {
    tell(player, "No RTP regions are available.");
    return;
  }
  if (regions.length === 1) {
    tell(player, randomTeleport(player, regions[0].id).message);
    return;
  }
  const form = TauUi.action<{ regionId: string }>("Random Teleport").body("Choose a region.");
  for (const region of regions) form.button("region", region.name, { iconPath: ICONS.sidebar, value: { regionId: region.id } });
  form.button("back", "Back", { iconPath: ICONS.back });
  const response = await form.show(player);
  if (TauUi.isCanceledOrBack(response) || !response.value) return;
  tell(player, randomTeleport(player, response.value.regionId).message);
}

export async function showRtpAdminMenu(player: Player): Promise<void> {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to manage RTP.");
    return;
  }
  while (true) {
    const regions = Object.values(state.rtp.regions).sort((a, b) => a.name.localeCompare(b.name));
    const form = TauUi.action<{ regionId: string }>("RTP Admin")
      .body(`Enabled: ${state.rtp.config.enabled ? "On" : "Off"}\nRegions: ${regions.length}\nCooldown: ${state.rtp.config.cooldownSeconds}s`)
      .button("settings", "Global Settings", { iconPath: ICONS.settings })
      .button("create", "Create Region", { iconPath: ICONS.confirm });
    for (const region of regions) form.button("region", `${region.enabled ? "On" : "Off"}: ${region.name}`, { iconPath: ICONS.sidebar, value: { regionId: region.id } });
    form.button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (TauUi.isCanceledOrBack(response)) return;
    if (response.id === "create") {
      await createRegion(player);
      continue;
    }
    if (response.id === "settings") {
      const result = await TauUi.modal("RTP Settings")
        .toggle("enabled", "Enabled", state.rtp.config.enabled)
        .text("cooldown", "Default cooldown seconds", { defaultValue: String(state.rtp.config.cooldownSeconds) })
        .text("maxAttempts", "Max safe-location attempts", { defaultValue: String(state.rtp.config.maxAttempts) })
        .toggle("avoidClaims", "Avoid claims by default", state.rtp.config.avoidClaims)
        .toggle("avoidCustomAreas", "Avoid custom areas by default", state.rtp.config.avoidCustomAreas)
        .submitButton("Save")
        .show(player);
      if (result.canceled) continue;
      state.rtp.config.enabled = Boolean(result.values.enabled);
      state.rtp.config.cooldownSeconds = Math.max(0, Math.floor(Number(result.values.cooldown ?? state.rtp.config.cooldownSeconds)));
      state.rtp.config.maxAttempts = Math.max(1, Math.floor(Number(result.values.maxAttempts ?? state.rtp.config.maxAttempts)));
      state.rtp.config.avoidClaims = Boolean(result.values.avoidClaims);
      state.rtp.config.avoidCustomAreas = Boolean(result.values.avoidCustomAreas);
      saveRtp();
      tell(player, "RTP settings saved.");
      continue;
    }
    if (response.id === "region" && response.value) {
      const region = state.rtp.regions[response.value.regionId];
      if (region) await editRegion(player, region);
    }
  }
}
