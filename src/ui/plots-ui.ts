import { Player, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
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
    const form = new ActionFormData()
      .title("§3Plot Manager§r")
      .body(`§7Enabled: §f${cfg.enabled ? "On" : "Off"}\n§7Count: §f${cfg.activePlotCount}\n§7Size: §f${cfg.size.x}x${cfg.size.y}x${cfg.size.z}\n§7Spacing: §f${cfg.spacing}\n§7Save Interval: §f${cfg.saveIntervalTicks} ticks\n§7Slots: §f${Object.keys(state.plots.slots).length}\n§7Borders: §f${cfg.autoBuild.addBorders ? "On" : "Off"}\n§7Title: §f${cfg.autoBuild.showEnterTitle ? "On" : "Off"}`)
      .button(`Toggle Plots: ${cfg.enabled ? "On" : "Off"}`, ICONS.plot)
      .button("Set Origin Here", ICONS.utility)
      .button("Set Count", ICONS.edit)
      .button("Set Size", ICONS.edit)
      .button("Set Spacing", ICONS.edit)
      .button("Set Save Interval", ICONS.edit)
      .button("Build Manual Grid", ICONS.confirm)
      .button("Build Geometry Only", ICONS.confirm)
      .button("Rebuild Plots", ICONS.confirm)
      .button("Auto Build Options", ICONS.utility)
      .button("Edit Slot Bounds", ICONS.item)
      .button("Validate Layout", ICONS.utility)
      .button("Plot Occupancy", ICONS.menu)
      .button("Fix Plots", ICONS.confirm)
      .button("Force Release", ICONS.utility)
      .button("Reassign Slot", ICONS.item)
      .button("Teleport To Slot", ICONS.plot)
      .button("Clean Up Plots", ICONS.utility)
      .button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;

    if (response.selection === 0) {
      cfg.enabled = !cfg.enabled;
      state.plots.config.enabled = cfg.enabled;
      savePlots();
      continue;
    }
    if (response.selection === 1) {
      setPlotOriginFromPlayer(player);
      tell(player, "Plot origin set to your current location.");
      continue;
    }
    if (response.selection === 2) {
      const modal = new ModalFormData().title("Set Plot Count").textField("Count", "10", { defaultValue: String(cfg.activePlotCount) }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const count = Math.floor(Number(result.formValues[0] ?? cfg.activePlotCount));
      if (Number.isFinite(count) && count > 0) setPlotCount(count);
      continue;
    }
    if (response.selection === 3) {
      const modal = new ModalFormData()
        .title("Set Plot Size")
        .textField("X", "20", { defaultValue: String(cfg.size.x) })
        .textField("Y", "10", { defaultValue: String(cfg.size.y) })
        .textField("Z", "20", { defaultValue: String(cfg.size.z) })
        .submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const x = Math.floor(Number(result.formValues[0] ?? cfg.size.x));
      const y = Math.floor(Number(result.formValues[1] ?? cfg.size.y));
      const z = Math.floor(Number(result.formValues[2] ?? cfg.size.z));
      if (Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0 && Number.isFinite(z) && z > 0) {
        setPlotSize(x, y, z);
      }
      continue;
    }
    if (response.selection === 4) {
      const modal = new ModalFormData().title("Set Plot Spacing").textField("Spacing", "4", { defaultValue: String(cfg.spacing) }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const spacing = Math.floor(Number(result.formValues[0] ?? cfg.spacing));
      if (Number.isFinite(spacing) && spacing >= 0) setPlotSpacing(spacing);
      continue;
    }
    if (response.selection === 5) {
      const modal = new ModalFormData().title("Set Save Interval (ticks)").textField("Ticks", "20", { defaultValue: String(cfg.saveIntervalTicks) }).submitButton("Save");
      const result = await modal.show(player).catch(() => undefined);
      if (!result || result.canceled || !result.formValues) continue;
      const ticks = Math.max(1, Math.floor(Number(result.formValues[0] ?? cfg.saveIntervalTicks)));
      if (Number.isFinite(ticks)) {
        state.plots.config.saveIntervalTicks = ticks;
        savePlots();
        tell(player, `Plot save interval set to ${ticks} ticks.`);
      }
      continue;
    }
    if (response.selection === 6) {
      const built = buildManualGridSlots();
      tell(player, built.message);
      continue;
    }
    if (response.selection === 7) {
      const built = buildPlotGeometry();
      tell(player, built.message);
      continue;
    }
    if (response.selection === 8) {
      const built = autoBuildPlots();
      tell(player, built.message);
      continue;
    }
    if (response.selection === 9) {
      await showPlotAutoBuildOptions(player);
      continue;
    }
    if (response.selection === 10) {
      await showPlotSlotEditor(player);
      continue;
    }
    if (response.selection === 11) {
      const result = validatePlotLayout();
      if (result.ok) tell(player, "Layout valid. No overlaps found.");
      else {
        tell(player, "Layout has issues:");
        for (const line of result.errors.slice(0, 12)) tell(player, `- ${line}`);
      }
      continue;
    }
    if (response.selection === 12) {
      const lines = getPlotStatusLines();
      if (lines.length === 0) tell(player, "No plot slots configured.");
      else {
        tell(player, "Plot occupancy:");
        for (const line of lines.slice(0, 30)) tell(player, line);
      }
      continue;
    }
    if (response.selection === 13) {
      const result = repairPlotSystem();
      tell(player, result.message);
      continue;
    }
    if (response.selection === 14) {
      await showPlotForceRelease(player);
      continue;
    }
    if (response.selection === 15) {
      await showPlotReassign(player);
      continue;
    }
    if (response.selection === 16) {
      await showPlotTeleport(player);
      continue;
    }
    if (response.selection === 17) {
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
    const form = new ModalFormData()
      .title("Auto Build Options")
      .toggle("Clear plot area before deploy", { defaultValue: auto.clearBase })
      .toggle("Add borders between plots", { defaultValue: auto.addBorders })
      .textField("Border block", "stone", { defaultValue: auto.borderBlock })
      .textField("Border height", "1", { defaultValue: String(auto.borderHeight) })
      .textField("Floor block (optional)", "grass_block", { defaultValue: auto.floorBlock ?? "" })
      .toggle("Show plot title on enter/near", { defaultValue: auto.showEnterTitle })
      .dropdown("Title mode", ["owner", "plot"], { defaultValueIndex: auto.titleMode === "owner" ? 0 : 1 })
      .textField("Title radius", "5", { defaultValue: String(auto.titleRadius) })
      .submitButton("Save");

    const result = await form.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues) return;

    updatePlotAutoBuildSettings({
      clearBase: Boolean(result.formValues[0]),
      addBorders: Boolean(result.formValues[1]),
      borderBlock: String(result.formValues[2] ?? "stone").trim() || "stone",
      borderHeight: Math.max(1, Math.floor(Number(result.formValues[3] ?? 1))),
      floorBlock: String(result.formValues[4] ?? "").trim() || undefined,
      showEnterTitle: Boolean(result.formValues[5]),
      titleMode: Number(result.formValues[6] ?? 0) === 0 ? "owner" : "plot",
      titleRadius: Math.max(1, Math.floor(Number(result.formValues[7] ?? 5))),
    });
    tell(player, "Auto build options saved.");
    return;
  }
}

async function showPlotForceRelease(player: Player) {
  while (true) {
    const entries = Object.entries(state.plots.slots);
    const form = new ActionFormData().title("Force Release").body("Select an occupied slot to release.");
    for (const [id, slot] of entries) {
      form.button(`${id} (${slot.occupiedByPlayerId ?? "free"})`, ICONS.delete);
    }
    form.button("Back", ICONS.back);
    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection >= entries.length) return;
    const [slotId] = entries[response.selection];
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

  const pickPlayer = new ActionFormData().title("Pick Player");
  for (const p of players) pickPlayer.button(p.name, ICONS.menu);
  pickPlayer.button("Back", ICONS.back);
  const pResp = await pickPlayer.show(player).catch(() => undefined);
  if (!pResp || pResp.canceled || pResp.selection === undefined) return;
  if (pResp.selection >= players.length) return;
  const target = players[pResp.selection];

  while (true) {
    const entries = Object.entries(state.plots.slots);
    const form = new ActionFormData().title(`Assign ${target.name}`).body("Select a free slot.");
    for (const [id, slot] of entries) {
      form.button(`${id} (${slot.occupiedByPlayerId ?? "free"})`, ICONS.binding);
    }
    form.button("Back", ICONS.back);
    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection >= entries.length) return;
    const [slotId] = entries[response.selection];
    const result = assignPlayerToSlot(target, slotId);
    tell(player, result.message);
    if (result.ok) return;
  }
}

async function showPlotTeleport(player: Player) {
  while (true) {
    const entries = Object.entries(state.plots.slots);
    const form = new ActionFormData().title("Teleport To Slot").body("Select a slot to teleport to its corner.");
    for (const [id, slot] of entries) {
      form.button(`${id} (${slot.min.x},${slot.min.y},${slot.min.z})`, ICONS.sidebar);
    }
    form.button("Back", ICONS.back);
    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection >= entries.length) return;
    const [slotId] = entries[response.selection];
    const result = teleportPlayerToSlot(player, slotId);
    tell(player, result.message);
    if (result.ok) return;
  }
}

async function showPlotSlotEditor(player: Player) {
  while (true) {
    const entries = Object.entries(state.plots.slots);
    const form = new ActionFormData().title("Plot Slots").body("Select a slot to set manual bounds from your current position.");
    for (const [id, slot] of entries) {
      form.button(`${id} (${slot.min.x},${slot.min.y},${slot.min.z})`, ICONS.menu);
    }
    form.button("Back", ICONS.back);

    const response = await form.show(player).catch(() => undefined);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection >= entries.length) return;

    const [slotId] = entries[response.selection];
    const modal = new ModalFormData()
      .title(`Manual Bounds: ${slotId}`)
      .textField("Corner A (x y z)", "0 64 0")
      .textField("Corner B (x y z)", "19 73 19")
      .submitButton("Apply");
    const result = await modal.show(player).catch(() => undefined);
    if (!result || result.canceled || !result.formValues) continue;
    const parse = (raw: string) => raw.trim().split(/\s+/).map((n) => Number(n));
    const a = parse(String(result.formValues[0] ?? ""));
    const b = parse(String(result.formValues[1] ?? ""));
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

  const form = new ActionFormData()
    .title("My Plot")
    .body(teamPlot && team ? `Team plot: ${team.name}` : mySlot ? `Your plot: ${mySlot.id}` : "You do not have a plot assigned.")
    .button("Teleport To My Plot", ICONS.sidebar)
    .button("Plot Info", ICONS.menu)
    .button("Back", ICONS.back);

  const response = await form.show(player).catch(() => undefined);
  if (!response || response.canceled || response.selection === undefined) return;
  if (response.selection === 2) return;

  if (!mySlot && !teamPlot) {
    tell(player, "No plot assigned.");
    return;
  }

  if (response.selection === 0) {
    const slot = teamPlot ?? mySlot;
    if (slot) tell(player, teleportPlayerToSlot(player, slot.id).message);
    return;
  }

  if (response.selection === 1) {
    const slot = teamPlot ?? mySlot;
    if (!slot) {
      tell(player, "No plot info available.");
      return;
    }
    tell(player, `Plot ${slot.id}: ${slot.min.x},${slot.min.y},${slot.min.z} -> ${slot.max.x},${slot.max.y},${slot.max.z}`);
    if (teamPlot && team) tell(player, `Team: ${team.name}`);
  }
}
