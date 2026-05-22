import { Player } from "@minecraft/server";
import { TauUi } from "../../ui";
import { state, saveShops, tell } from "../../storage";
import { ICONS } from "../../ui/icons";
import { showShopItemEditor } from "./editor";

export async function showShopProfilesEditor(player: Player) {
  while (true) {
    const ids = Object.keys(state.shops);
    const form = TauUi.action<{ profileId: string }>("Shop Profiles")
      .body(`Profiles: ${ids.length}`)
      .button("createProfile", "Create new profile", { iconPath: ICONS.confirm })
      .button("deleteProfile", "Delete profile", { iconPath: ICONS.delete })
      .button("back", "Back", { iconPath: ICONS.back });

    for (const id of ids) {
      form.button(id, id, { iconPath: ICONS.shop, value: { profileId: id } });
    }
    const response = await form.show(player);
    if (response.canceled || response.id === "back") return;

    if (response.id === "createProfile") {
      const modal = TauUi.modal("Create Shop Profile")
        .text("profileId", "Profile ID", { placeholder: "default", defaultValue: "default" })
        .text("currencyObjective", "Currency objective", { placeholder: "money", defaultValue: "money" })
        .submitButton("Create");
      const result = await modal.show(player);
      if (result.canceled) continue;
      const id = String(result.values.profileId ?? "").trim();
      const objective = String(result.values.currencyObjective ?? "").trim();
      if (!id || !objective) continue;
      state.shops[id] = state.shops[id] ?? {
        id,
        currencyObjective: objective,
        categories: [],
        items: [],
      };
      state.shops[id].currencyObjective = objective;
      saveShops();
      await showShopItemEditor(player, id);
      continue;
    }

    if (response.id === "deleteProfile") {
      if (ids.length === 0) {
        tell(player, "No profiles to delete.");
        continue;
      }
      const picker = TauUi.action<{ profileId: string }>("Delete Shop Profile");
      for (const id of ids) picker.button(id, id, { iconPath: ICONS.delete, value: { profileId: id } });
      picker.button("cancel", "Cancel", { iconPath: ICONS.cancel });
      const pick = await picker.show(player);
      if (pick.canceled || pick.id === "cancel") continue;
      const id = pick.value && typeof pick.value === "object" && "profileId" in pick.value ? (pick.value as { profileId: string }).profileId : pick.id;
      if (!ids.includes(id)) continue;
      delete state.shops[id];
      saveShops();
      tell(player, `Deleted profile "${id}".`);
      continue;
    }

    if (response.value && typeof response.value === "object" && "profileId" in response.value) {
      const pid = (response.value as { profileId: string }).profileId;
      if (ids.includes(pid)) {
        await showShopItemEditor(player, pid);
        continue;
      }
    }

    return;
  }
}
