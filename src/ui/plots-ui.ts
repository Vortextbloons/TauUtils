import { Player, world } from "@minecraft/server";
import { TauUi } from "./tau-ui";
import { ICONS } from "../types";
import { isFeatureEnabled, isOperator, savePlots, state, tell } from "../storage";
import { assignPlayerToSlot, autoBuildPlots, buildManualGridSlots, buildPlotGeometry, clearAllPlotSlots, forceReleasePlot, getAssignedSlotForOwner, getAssignedSlotForPlayer, getPlotStatusLines, repairPlotSystem, setPlotCount, setPlotOriginFromPlayer, setPlotSize, setPlotSpacing, setSlotManualBounds, teleportPlayerToSlot, updatePlotAutoBuildSettings, validatePlotLayout } from "../plots";
import { getPlayerTeam } from "../teams";

export async function showPlotManager(player: Player) {
  if (!isOperator(player)) {
    tell(player, "You must be an operator to edit plots.");
    return;
  }

  while (true) {
    const cfg = state.plots.config;
    const form = TauUi.action("§3Plot Manager§r")
      .body(`§7Enabled: §f${cfg.enabled ? "On" : "Off"}\n§7Count: §f${cfg.activePlotCount}\n§7Size: §f${cfg.size.x}x${cfg.size.y}x${cfg.size.z}\n§7Spacing: §f${cfg.spacing}\n§7Save Interval: §f${cfg.saveIntervalTicks} ticks\n§7Slots: §f${Object.keys(state.plots.slots).length}\n§7Borders: §f${cfg.autoBuild.addBorders ? "On" : "Off"}\n§7Title: §f${cfg.autoBuild.showEnterTitle ? "On" : "Off"}`)
      .button("toggle", `Toggle Plots: ${cfg.enabled ? "On" : "Off"}`, { iconPath: ICONS.plot })
      .button("origin", "Set Origin Here", { iconPath: ICONS.utility })
      .button("count", "Set Count", { iconPath: ICONS.edit })
      .button("size", "Set Size", { iconPath: ICONS.edit })
      .button("spacing", "Set Spacing", { iconPath: ICONS.edit })
      .button("saveInterval", "Set Save Interval", { iconPath: ICONS.edit })
      .button("buildManual", "Build Manual Grid", { iconPath: ICONS.confirm })
      .button("buildGeom", "Build Geometry Only", { iconPath: ICONS.confirm })
      .button("rebuild", "Rebuild Plots", { iconPath: ICONS.confirm })
      .button("autoBuildOpts", "Auto Build Options", { iconPath: ICONS.utility })
      .button("editBounds", "Edit Slot Bounds", { iconPath: ICONS.item })
      .button("validate", "Validate Layout", { iconPath: ICONS.utility })
      .button("occupancy", "Plot Occupancy", { iconPath: ICONS.menu })
      .button("fix", "Fix Plots", { iconPath: ICONS.confirm })
      .button("forceRelease", "Force Release", { iconPath: ICONS.utility })
      .button("reassign", "Reassign Slot", { iconPath: ICONS.item })
      .button("tpSlot", "Teleport To Slot", { iconPath: ICONS.plot })
      .button("cleanup", "Clean Up Plots", { iconPath: ICONS.utility })
      .button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (response.canceled) return;

    if (response.id === "toggle") {
      cfg.enabled = !cfg.enabled;
      state.plots.config.enabled = cfg.enabled;
      savePlots();
      continue;
    }
    if (response.id === "origin") {
      setPlotOriginFromPlayer(player);
      tell(player, "Plot origin set to your current location.");
      continue;
    }
    if (response.id === "count") {
      const result = await TauUi.modal("Set Plot Count").text("count", "Count", { placeholder: "10", defaultValue: String(cfg.activePlotCount) }).submitButton("Save").show(player);
      if (result.canceled) continue;
      const count = Math.floor(Number(result.values.count ?? cfg.activePlotCount));
      if (Number.isFinite(count) && count > 0) setPlotCount(count);
      continue;
    }
    if (response.id === "size") {
      const result = await TauUi.modal("Set Plot Size")
        .text("x", "X", { placeholder: "20", defaultValue: String(cfg.size.x) })
        .text("y", "Y", { placeholder: "10", defaultValue: String(cfg.size.y) })
        .text("z", "Z", { placeholder: "20", defaultValue: String(cfg.size.z) })
        .submitButton("Save").show(player);
      if (result.canceled) continue;
      const x = Math.floor(Number(result.values.x ?? cfg.size.x));
      const y = Math.floor(Number(result.values.y ?? cfg.size.y));
      const z = Math.floor(Number(result.values.z ?? cfg.size.z));
      if (Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0 && Number.isFinite(z) && z > 0) {
        setPlotSize(x, y, z);
      }
      continue;
    }
    if (response.id === "spacing") {
      const result = await TauUi.modal("Set Plot Spacing").text("spacing", "Spacing", { placeholder: "4", defaultValue: String(cfg.spacing) }).submitButton("Save").show(player);
      if (result.canceled) continue;
      const spacing = Math.floor(Number(result.values.spacing ?? cfg.spacing));
      if (Number.isFinite(spacing) && spacing >= 0) setPlotSpacing(spacing);
      continue;
    }
    if (response.id === "saveInterval") {
      const result = await TauUi.modal("Set Save Interval (ticks)").text("ticks", "Ticks", { placeholder: "20", defaultValue: String(cfg.saveIntervalTicks) }).submitButton("Save").show(player);
      if (result.canceled) continue;
      const ticks = Math.max(1, Math.floor(Number(result.values.ticks ?? cfg.saveIntervalTicks)));
      if (Number.isFinite(ticks)) {
        state.plots.config.saveIntervalTicks = ticks;
        savePlots();
        tell(player, `Plot save interval set to ${ticks} ticks.`);
      }
      continue;
    }
    if (response.id === "buildManual") {
      const built = buildManualGridSlots();
      tell(player, built.message);
      continue;
    }
    if (response.id === "buildGeom") {
      const built = buildPlotGeometry();
      tell(player, built.message);
      continue;
    }
    if (response.id === "rebuild") {
      const built = autoBuildPlots();
      tell(player, built.message);
      continue;
    }
    if (response.id === "autoBuildOpts") {
      await showPlotAutoBuildOptions(player);
      continue;
    }
    if (response.id === "editBounds") {
      await showPlotSlotEditor(player);
      continue;
    }
    if (response.id === "validate") {
      const result = validatePlotLayout();
      if (result.ok) tell(player, "Layout valid. No overlaps found.");
      else {
        tell(player, "Layout has issues:");
        for (const line of result.errors.slice(0, 12)) tell(player, `- ${line}`);
      }
      continue;
    }
    if (response.id === "occupancy") {
      const lines = getPlotStatusLines();
      if (lines.length === 0) tell(player, "No plot slots configured.");
      else {
        tell(player, "Plot occupancy:");
        for (const line of lines.slice(0, 30)) tell(player, line);
      }
      continue;
    }
    if (response.id === "fix") {
      const result = repairPlotSystem();
      tell(player, result.message);
      continue;
    }
    if (response.id === "forceRelease") {
      await showPlotForceRelease(player);
      continue;
    }
    if (response.id === "reassign") {
      await showPlotReassign(player);
      continue;
    }
    if (response.id === "tpSlot") {
      await showPlotTeleport(player);
      continue;
    }
    if (response.id === "cleanup") {
      const result = clearAllPlotSlots();
      tell(player, result.message);
      continue;
    }
    return;
  }
}

export async function showPlotPlayerMenuFromCreator(player: Player) {
  await showPlotPlayerMenu(player);
}

async function showPlotAutoBuildOptions(player: Player) {
  while (true) {
    const auto = state.plots.config.autoBuild;
    const result = await TauUi.modal("Auto Build Options")
      .toggle("clearBase", "Clear plot area before deploy", auto.clearBase)
      .toggle("addBorders", "Add borders between plots", auto.addBorders)
      .text("borderBlock", "Border block", { placeholder: "stone", defaultValue: auto.borderBlock })
      .text("borderHeight", "Border height", { placeholder: "1", defaultValue: String(auto.borderHeight) })
      .text("floorBlock", "Floor block (optional)", { placeholder: "grass_block", defaultValue: auto.floorBlock ?? "" })
      .toggle("showEnterTitle", "Show plot title on enter/near", auto.showEnterTitle)
      .dropdown("titleMode", "Title mode", ["owner", "plot"], auto.titleMode === "owner" ? 0 : 1)
      .text("titleRadius", "Title radius", { placeholder: "5", defaultValue: String(auto.titleRadius) })
      .submitButton("Save").show(player);

    if (result.canceled) return;

    updatePlotAutoBuildSettings({
      clearBase: Boolean(result.values.clearBase),
      addBorders: Boolean(result.values.addBorders),
      borderBlock: String(result.values.borderBlock ?? "stone").trim() || "stone",
      borderHeight: Math.max(1, Math.floor(Number(result.values.borderHeight ?? 1))),
      floorBlock: String(result.values.floorBlock ?? "").trim() || undefined,
      showEnterTitle: Boolean(result.values.showEnterTitle),
      titleMode: Number(result.values.titleMode ?? 0) === 0 ? "owner" : "plot",
      titleRadius: Math.max(1, Math.floor(Number(result.values.titleRadius ?? 5))),
    });
    tell(player, "Auto build options saved.");
    return;
  }
}

async function showPlotForceRelease(player: Player) {
  while (true) {
    const entries = Object.entries(state.plots.slots);
    const form = TauUi.action<{ slotId: string }>("Force Release").body("Select an occupied slot to release.");
    for (const [id, slot] of entries) {
      form.button("slot", `${id} (${slot.occupiedByPlayerId ?? "free"})`, { iconPath: ICONS.delete, value: { slotId: id } });
    }
    form.button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (TauUi.isCanceledOrBack(response) || !response.value) return;
    const { slotId } = response.value;
    const ok = forceReleasePlot(slotId);
    tell(player, ok ? `Released ${slotId}.` : `Failed to release ${slotId}.`);
  }
}

async function showPlotReassign(player: Player) {
  const players = world.getAllPlayers();
  if (players.length === 0) {
    tell(player, "No online players to assign.");
    return;
  }

  const pickPlayer = TauUi.action<{ name: string }>("Pick Player");
  for (const p of players) pickPlayer.button("player", p.name, { iconPath: ICONS.menu, value: { name: p.name } });
  pickPlayer.button("back", "Back", { iconPath: ICONS.back });
  const pResp = await pickPlayer.show(player);
  if (TauUi.isCanceledOrBack(pResp) || !pResp.value) return;
  const targetName = pResp.value.name;
  const target = players.find((p) => p.name === targetName);
  if (!target) return;

  while (true) {
    const entries = Object.entries(state.plots.slots);
    const form = TauUi.action<{ slotId: string }>(`Assign ${targetName}`).body("Select a free slot.");
    for (const [id, slot] of entries) {
      form.button("slot", `${id} (${slot.occupiedByPlayerId ?? "free"})`, { iconPath: ICONS.binding, value: { slotId: id } });
    }
    form.button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (TauUi.isCanceledOrBack(response) || !response.value) return;
    const result = assignPlayerToSlot(target, response.value.slotId);
    tell(player, result.message);
    if (result.ok) return;
  }
}

async function showPlotTeleport(player: Player) {
  while (true) {
    const entries = Object.entries(state.plots.slots);
    const form = TauUi.action<{ slotId: string }>("Teleport To Slot").body("Select a slot to teleport to its corner.");
    for (const [id, slot] of entries) {
      form.button("slot", `${id} (${slot.min.x},${slot.min.y},${slot.min.z})`, { iconPath: ICONS.sidebar, value: { slotId: id } });
    }
    form.button("back", "Back", { iconPath: ICONS.back });
    const response = await form.show(player);
    if (TauUi.isCanceledOrBack(response) || !response.value) return;
    const { slotId } = response.value;
    const result = teleportPlayerToSlot(player, slotId);
    tell(player, result.message);
    if (result.ok) return;
  }
}

async function showPlotSlotEditor(player: Player) {
  while (true) {
    const entries = Object.entries(state.plots.slots);
    const form = TauUi.action<{ slotId: string }>("Plot Slots").body("Select a slot to set manual bounds from your current position.");
    for (const [id, slot] of entries) {
      form.button("slot", `${id} (${slot.min.x},${slot.min.y},${slot.min.z})`, { iconPath: ICONS.menu, value: { slotId: id } });
    }
    form.button("back", "Back", { iconPath: ICONS.back });

    const response = await form.show(player);
    if (TauUi.isCanceledOrBack(response) || !response.value) return;

    const { slotId } = response.value;
    const result = await TauUi.modal(`Manual Bounds: ${slotId}`)
      .text("cornerA", "Corner A (x y z)", { placeholder: "0 64 0" })
      .text("cornerB", "Corner B (x y z)", { placeholder: "19 73 19" })
      .submitButton("Apply").show(player);
    if (result.canceled) continue;
    const parse = (raw: string) => raw.trim().split(/\s+/).map((n) => Number(n));
    const a = parse(String(result.values.cornerA ?? ""));
    const b = parse(String(result.values.cornerB ?? ""));
    if (a.length !== 3 || b.length !== 3 || a.some((n) => !Number.isFinite(n)) || b.some((n) => !Number.isFinite(n))) {
      tell(player, "Invalid coordinates. Use: x y z");
      continue;
    }
    setSlotManualBounds(slotId, { x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] });
    tell(player, `Manual bounds applied to ${slotId}.`);
  }
}

export async function showPlotPlayerMenu(player: Player) {
  if (!isFeatureEnabled("plotTp")) {
    tell(player, "Plot teleport is disabled.");
    return;
  }
  const team = getPlayerTeam(player);
  const teamPlot = team && team.teamPlotEnabled ? getAssignedSlotForOwner(team.ownerPlayerId) : undefined;
  const mySlot = getAssignedSlotForPlayer(player);

  const form = TauUi.action("My Plot")
    .body(teamPlot && team ? `Team plot: ${team.name}` : mySlot ? `Your plot: ${mySlot.id}` : "You do not have a plot assigned.")
    .button("tp", "Teleport To My Plot", { iconPath: ICONS.sidebar })
    .button("info", "Plot Info", { iconPath: ICONS.menu })
    .button("back", "Back", { iconPath: ICONS.back });

  const response = await form.show(player);
  if (TauUi.isCanceledOrBack(response)) return;

  if (!mySlot && !teamPlot) {
    tell(player, "No plot assigned.");
    return;
  }

  if (response.id === "tp") {
    const slot = teamPlot ?? mySlot;
    if (slot) tell(player, teleportPlayerToSlot(player, slot.id).message);
    return;
  }

  if (response.id === "info") {
    const slot = teamPlot ?? mySlot;
    if (!slot) {
      tell(player, "No plot info available.");
      return;
    }
    tell(player, `Plot ${slot.id}: ${slot.min.x},${slot.min.y},${slot.min.z} -> ${slot.max.x},${slot.max.y},${slot.max.z}`);
    if (teamPlot && team) tell(player, `Team: ${team.name}`);
  }
}
