import { ItemStack, Player } from "@minecraft/server";
import { TauUi } from "../../ui";
import {
  findShopProfile,
  getInventoryContainer,
  getScore,
  isFeatureEnabled,
  setScore,
  state,
  tell,
} from "../../storage";
import { type ShopItemDefinition, type ShopProfile } from "../../types";
import {
  shopLabel,
  shopItemKey,
  ensureShopItemId,
  getShopItemByKey,
  getEnchantmentPreviewText,
  buildItemStacksForPurchase,
  itemMatchesDefinition,
  getItemInstanceDefinition,
  getItemInstanceCount,
  removeItemInstance,
  snapshotContainer,
  restoreContainer,
  normalizeShopProfileItems,
  getHeldItem,
  isProtectedCrateKey,
} from "../utils";
import { normalizeItemId } from "../../shared/item-id";
import { ICONS } from "../../ui/icons";

type SellAllSlotPlan = {
  slot: number;
  amount: number;
};

type SellAllPlanEntry = {
  item: ShopItemDefinition;
  owned: number;
  total: number;
  slots: SellAllSlotPlan[];
};

function buildSellAllPlan(player: Player, profile: ShopProfile): { entries: SellAllPlanEntry[]; totalGain: number } {
  const container = getInventoryContainer(player);
  if (!container) return { entries: [], totalGain: 0 };

  const slotRemaining = new Map<number, number>();
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (!stack || isProtectedCrateKey(stack)) continue;
    slotRemaining.set(slot, stack.amount);
  }

  const entries: SellAllPlanEntry[] = [];
  let totalGain = 0;
  for (const item of profile.items) {
    if (item.bundle && item.bundle.length > 0) continue;
    if (item.canSell === false || item.sellPrice <= 0) continue;

    const def = getItemInstanceDefinition(item);
    let owned = 0;
    const slots: SellAllSlotPlan[] = [];

    for (const [slot, remaining] of slotRemaining) {
      if (remaining <= 0) continue;
      const stack = container.getItem(slot);
      if (!stack || !itemMatchesDefinition(stack, def)) continue;
      owned += remaining;
      slots.push({ slot, amount: remaining });
      slotRemaining.set(slot, 0);
    }

    if (owned <= 0) continue;

    const total = item.sellPrice * owned;
    totalGain += total;
    entries.push({ item, owned, total, slots });
  }

  return { entries, totalGain };
}

function applySellAllPlan(player: Player, entries: SellAllPlanEntry[]): boolean {
  const container = getInventoryContainer(player);
  if (!container) return false;
  for (const entry of entries) {
    const def = getItemInstanceDefinition(entry.item);
    for (const plan of entry.slots) {
      let remaining = plan.amount;
      const stack = container.getItem(plan.slot);
      if (!stack || !itemMatchesDefinition(stack, def)) return false;
      if (stack.amount < remaining) return false;
      if (stack.amount === remaining) {
        container.setItem(plan.slot, undefined);
        remaining = 0;
      } else {
        stack.amount -= remaining;
        remaining = 0;
        container.setItem(plan.slot, stack);
      }
      if (remaining !== 0) return false;
    }
  }
  return true;
}

export async function sellAllSellableItems(player: Player, profileId: string) {
  if (!isFeatureEnabled("shops")) {
    tell(player, "Shops are disabled.");
    return;
  }

  const profile = findShopProfile(profileId);
  if (!profile) {
    tell(player, `Shop profile "${profileId}" was not found.`);
    return;
  }
  normalizeShopProfileItems(profile);

  const current = getScore(player, profile.currencyObjective);
  if (current === undefined) {
    tell(player, `Missing scoreboard objective "${profile.currencyObjective}".`);
    return;
  }

  const plan = buildSellAllPlan(player, profile);
  const sellItems = plan.entries;
  const totalGain = plan.totalGain;

  if (sellItems.length === 0) {
    tell(player, "Nothing sellable was found.");
    return;
  }

  const lines: string[] = [];
  for (const entry of sellItems) {
    let name = shopLabel(entry.item);
    if (entry.item.showEnchantsInPreview && entry.item.enchantments && entry.item.enchantments.length > 0) {
      const enchStr = getEnchantmentPreviewText(entry.item.enchantments);
      name += ` §7(${enchStr})`;
    }
    if (entry.item.lore && entry.item.lore.length > 0) {
      name += ` §7[${entry.item.lore.length} lore]`;
    }
    lines.push(`§e${entry.owned}x ${name}§7 = +${entry.total}`);
  }
  lines.push("");
  lines.push(`§aTotal: +${totalGain} ${profile.currencyObjective}`);

  while (true) {
    const confirmForm = TauUi.action("Sell All")
      .body(`Sell these items?\n\n${lines.join("\n")}`)
      .button("confirmSell", "§aConfirm Sell", { iconPath: ICONS.sellAll })
      .button("cancel", "Cancel", { iconPath: ICONS.cancel });

    const response = await confirmForm.show(player);
    if (response.canceled || response.id === "cancel") return;

    if (response.id === "confirmSell") {
      const latest = buildSellAllPlan(player, profile);
      if (latest.entries.length === 0) {
        tell(player, "Nothing sellable was found.");
        return;
      }
      const latestBalance = getScore(player, profile.currencyObjective);
      if (latestBalance === undefined) {
        tell(player, `Missing scoreboard objective "${profile.currencyObjective}".`);
        return;
      }
      const container = getInventoryContainer(player);
      if (!container) {
        tell(player, "Inventory is unavailable.");
        return;
      }
      const snapshot = snapshotContainer(container);
      if (!applySellAllPlan(player, latest.entries)) {
        tell(player, "Inventory changed before the sale could complete. Try again.");
        return;
      }
      if (!setScore(player, profile.currencyObjective, latestBalance + latest.totalGain)) {
        restoreContainer(container, snapshot);
        tell(player, "Failed to add currency; sale was reverted.");
        return;
      }
      tell(player, `§aSold all items for §e${latest.totalGain} ${profile.currencyObjective}§a!`);
      return;
    }
    return;
  }
}

export async function openShopTransaction(
  player: Player,
  transactionValue: string
) {
  if (!isFeatureEnabled("shops")) {
    tell(player, "Shops are disabled.");
    return;
  }

  const [profileOrDefault, itemOrUndefined] = transactionValue.includes("|")
    ? transactionValue.split("|", 2)
    : ["default", transactionValue];

  const profile = findShopProfile(profileOrDefault);
  if (!profile) {
    tell(player, `Shop profile "${profileOrDefault}" was not found.`);
    return;
  }

  const itemToken = String(itemOrUndefined ?? "").trim();
  const keyMatch = /^key:(.+)$/i.exec(itemToken);
  const idxMatch = /^idx:(\d+)$/i.exec(itemToken);
  const item = keyMatch
    ? getShopItemByKey(profile, keyMatch[1].trim())
    : idxMatch
      ? profile.items[Math.floor(Number(idxMatch[1]))]
      : profile.items.find((entry, index) => ensureShopItemId(entry, profile.id, index) === itemToken || normalizeItemId(entry.itemId) === normalizeItemId(itemOrUndefined));
  if (!item) {
    tell(
      player,
      `Shop item "${itemOrUndefined}" was not found in profile "${profile.id}".`
    );
    return;
  }

  const title = shopLabel(item);
  const actionForm = TauUi.action<{ mode: "buy" | "sell" | "sell_all_item"; qty: number }>(`§l${title}§r`)
    .body(
      [
        `Currency: ${profile.currencyObjective}`,
        `Buy price: ${item.canBuy === false ? "Off" : item.buyPrice}`,
        `Sell price: ${item.bundle && item.bundle.length > 0 ? "N/A" : item.canSell === false ? "Off" : item.sellPrice}`,
        `Qty options: ${item.quantities.join(", ")}`,
      ].join("\n")
    );

  for (const qty of item.quantities) {
    const buyCost = item.buyPrice * qty;
    if (item.canBuy !== false && item.buyPrice > 0) {
      actionForm.button(`buy:${qty}`, `Buy ${qty} (-${buyCost})`, { iconPath: ICONS.buy, value: { mode: "buy", qty } });
    }
    if (item.bundle && item.bundle.length > 0) {
      continue;
    }
    if (item.canSell !== false && item.sellPrice > 0) {
      const sellGain = item.sellPrice * qty;
      actionForm.button(`sell:${qty}`, `Sell ${qty} (+${sellGain})`, { iconPath: ICONS.sell, value: { mode: "sell", qty } });
    }
  }
  if (item.canSell !== false && item.sellPrice > 0 && !(item.bundle && item.bundle.length > 0)) {
    actionForm.button("sell_all_item", "Sell All This Item", { iconPath: ICONS.sellAll, value: { mode: "sell_all_item", qty: 0 } });
  }
  actionForm.button("close", "Close", { iconPath: ICONS.cancel });

  const response = await actionForm.show(player);
  if (response.canceled || response.id === "close" || !response.value) return;

  const op = response.value;
  if (op.mode === "buy") {
    const current = getScore(player, profile.currencyObjective);
    if (current === undefined) {
      tell(
        player,
        `Missing scoreboard objective "${profile.currencyObjective}".`
      );
      return;
    }

    const cost = item.buyPrice * op.qty;
    if (current < cost) {
      tell(
        player,
        `You need ${cost} ${profile.currencyObjective} to buy ${op.qty}.`
      );
      return;
    }

    const container = getInventoryContainer(player);
    if (!container) {
      tell(player, "Inventory is unavailable.");
      return;
    }

    const snapshot = snapshotContainer(container);
    const stacks = buildItemStacksForPurchase(item, op.qty);
    for (const stack of stacks) {
      const leftover = container.addItem(stack);
      if (!leftover) continue;
      restoreContainer(container, snapshot);
      tell(player, "Not enough inventory space to complete this purchase.");
      return;
    }

    if (!setScore(player, profile.currencyObjective, current - cost)) {
      restoreContainer(container, snapshot);
      tell(player, "Failed to charge currency; purchase was reverted.");
      return;
    }

    tell(player, `Purchased ${op.qty}x ${shopLabel(item)} for ${cost}.`);
  } else if (op.mode === "sell") {
    const owned = getItemInstanceCount(player, item);
    if (owned < op.qty) {
      tell(player, `You need ${op.qty}x ${shopLabel(item)} to sell.`);
      return;
    }

    const current = getScore(player, profile.currencyObjective);
    if (current === undefined) {
      tell(player, `Missing scoreboard objective "${profile.currencyObjective}".`);
      return;
    }

    const container = getInventoryContainer(player);
    if (!container) {
      tell(player, "Inventory is unavailable.");
      return;
    }

    const snapshot = snapshotContainer(container);
    if (!removeItemInstance(player, item, op.qty)) {
      tell(player, "Sell failed while removing items.");
      return;
    }

    const gain = item.sellPrice * op.qty;
    if (!setScore(player, profile.currencyObjective, current + gain)) {
      restoreContainer(container, snapshot);
      tell(player, "Failed to add currency after selling. Items were restored.");
      return;
    }

    tell(player, `Sold ${op.qty}x ${shopLabel(item)} for ${gain}.`);
  } else {
    const owned = getItemInstanceCount(player, item);
    if (owned <= 0) {
      tell(player, `You have no ${shopLabel(item)} to sell.`);
      return;
    }

    const current = getScore(player, profile.currencyObjective);
    if (current === undefined) {
      tell(player, `Missing scoreboard objective "${profile.currencyObjective}".`);
      return;
    }

    const container = getInventoryContainer(player);
    if (!container) {
      tell(player, "Inventory is unavailable.");
      return;
    }

    const snapshot = snapshotContainer(container);
    if (!removeItemInstance(player, item, owned)) {
      tell(player, "Sell-all failed while removing items.");
      return;
    }

    const gain = item.sellPrice * owned;
    if (!setScore(player, profile.currencyObjective, current + gain)) {
      restoreContainer(container, snapshot);
      tell(player, "Failed to add currency after selling all items. Items were restored.");
      return;
    }

    tell(player, `Sold all ${owned}x ${shopLabel(item)} for ${gain}.`);
  }
}
