import { Player } from "@minecraft/server";
import { TauUi } from "../tau-ui";
import { ICONS } from "../../types";
import { getOnlinePlayersExcept, getPlayerId, state, tell } from "../../storage";
import { createTpaRequest, deleteHome, listHomes, payPlayer, setHome, teleportHome, updatePlayerSettings } from "../../social";

export async function showTpaMenu(player: Player) {
  const players = getOnlinePlayersExcept(player);
  if (players.length === 0) {
    tell(player, "No online players available.");
    return;
  }
  const form = TauUi.action<{ index: number }>("TPA").body("Send a teleport request.");
  players.forEach((p, i) => form.button("player", p.name, { iconPath: ICONS.menu, value: { index: i } }));
  form.back("Back", ICONS.back);
  const res = await form.show(player);
  if (TauUi.isCanceledOrBack(res) || !res.value) return;
  const target = players[res.value.index];
  const result = createTpaRequest(player, target);
  tell(player, result.message);
  if (result.ok) tell(target, `§e${player.name} sent you a TPA request. Use /tau:tpaccept or /tau:tpdeny.`);
}

export async function showHomesMenu(player: Player) {
  while (true) {
    const homes = listHomes(player);
    const form = TauUi.action("Homes")
      .body(`Your homes: ${homes.length}`)
      .button("set", "Set Home", { iconPath: ICONS.confirm })
      .button("tp", "Teleport Home", { iconPath: ICONS.sidebar })
      .button("delete", "Delete Home", { iconPath: ICONS.delete })
      .back("Back", ICONS.back);
    const res = await form.show(player);
    if (TauUi.isCanceledOrBack(res)) return;

    if (res.id === "set") {
      const result = await TauUi.modal("Set Home").text("name", "Home name", { placeholder: "home" }).submitButton("Save").show(player);
      if (result.canceled) continue;
      tell(player, setHome(player, String(result.values.name ?? "home")).message);
      continue;
    }

    if (homes.length === 0) {
      tell(player, "No homes set.");
      continue;
    }

    const pick = TauUi.action<{ index: number }>(res.id === "tp" ? "Teleport Home" : "Delete Home");
    homes.forEach((name, i) => pick.button("home", name, { iconPath: ICONS.menu, value: { index: i } }));
    pick.back("Back", ICONS.back);
    const picked = await pick.show(player);
    if (TauUi.isCanceledOrBack(picked) || !picked.value) continue;
    const name = homes[picked.value.index];
    if (res.id === "tp") tell(player, teleportHome(player, name).message);
    else tell(player, deleteHome(player, name).message);
  }
}

export async function showPayMenu(player: Player) {
  const players = getOnlinePlayersExcept(player);
  if (players.length === 0) {
    tell(player, "No online players available.");
    return;
  }
  const pick = TauUi.action<{ index: number }>("Pay Player").body("Select a player to pay.");
  players.forEach((p, i) => pick.button("player", p.name, { iconPath: ICONS.shop, value: { index: i } }));
  pick.back("Back", ICONS.back);
  const picked = await pick.show(player);
  if (TauUi.isCanceledOrBack(picked) || !picked.value) return;
  const target = players[picked.value.index];
  const result = await TauUi.modal(`Pay ${target.name}`).text("amount", "Amount", { placeholder: "100" }).submitButton("Send").show(player);
  if (result.canceled) return;
  const amount = Number(result.values.amount ?? "0");
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
  const result = await TauUi.modal("Player Settings")
    .toggle("allowTpa", "Allow TPA requests", current.allowTpa)
    .toggle("allowPay", "Allow payments", current.allowPay)
    .toggle("showSocialMessages", "Show social messages", current.showSocialMessages)
    .submitButton("Save")
    .show(player);
  if (result.canceled) return;
  updatePlayerSettings(player, {
    allowTpa: Boolean(result.values.allowTpa),
    allowPay: Boolean(result.values.allowPay),
    showSocialMessages: Boolean(result.values.showSocialMessages),
  });
  tell(player, "Player settings saved.");
}
