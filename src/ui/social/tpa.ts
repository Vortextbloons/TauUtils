import { Player, system, world } from "@minecraft/server";
import { ICONS, type TpaRequest } from "../../types";
import { TauUi, message as tauMessage } from "../tau-ui";
import {
  getOnlinePlayersExcept,
  getPlayerId,
  state,
  tell,
} from "../../storage";
import {
  acceptTpaRequest,
  cancelOutgoingTpaRequest,
  createTpaRequest,
  denyTpaRequest,
  listIncomingTpaRequests,
  listOutgoingTpaRequests,
} from "../../social/core";
import { registerTpaIncomingHandler } from "../../social/expiry";

const PAGE_SIZE = 12;

function formatAge(ms: number): string {
  if (ms < 0) return "expired";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatIncomingLabel(req: TpaRequest, now: number): string {
  const remaining = req.expiresAt - now;
  return `§e${req.fromName}§r · ${formatAge(remaining)} left`;
}

function formatOutgoingLabel(req: TpaRequest, now: number): string {
  const remaining = req.expiresAt - now;
  return `§e${req.toName}§r · ${formatAge(remaining)} left`;
}

async function pickOnlinePlayer(player: Player, title: string): Promise<Player | undefined> {
  let page = 0;
  while (true) {
    const candidates = getOnlinePlayersExcept(player);
    if (candidates.length === 0) {
      tell(player, "No online players available.");
      return undefined;
    }
    const slice = TauUi.paginate(candidates, page, PAGE_SIZE);
    const form = TauUi.action<number>(`${title} ${slice.page + 1}/${slice.pageCount}`)
      .body("Select a player to teleport to.");
    for (let i = 0; i < slice.items.length; i++) {
      const absoluteIndex = slice.startIndex + i;
      form.button("player", slice.items[absoluteIndex].name, { iconPath: ICONS.menu, value: absoluteIndex });
    }
    if (slice.hasPrevious) form.button("previous", "Previous", { iconPath: ICONS.back });
    if (slice.hasNext) form.button("next", "Next", { iconPath: ICONS.back });
    form.back("Back", ICONS.back);

    const result = await form.show(player);
    if (TauUi.isCanceledOrBack(result)) return undefined;
    if (result.id === "previous" && slice.hasPrevious) {
      page--;
      continue;
    }
    if (result.id === "next" && slice.hasNext) {
      page++;
      continue;
    }
    if (result.id === "player" && result.value !== undefined) return candidates[result.value];
  }
}

async function pickRequestId(
  player: Player,
  title: string,
  requests: TpaRequest[],
  labelFor: (req: TpaRequest) => string,
): Promise<string | undefined> {
  if (requests.length === 0) return undefined;
  let page = 0;
  while (true) {
    const slice = TauUi.paginate(requests, page, PAGE_SIZE);
    const form = TauUi.action<string>(`${title} ${slice.page + 1}/${slice.pageCount}`)
      .body(`${requests.length} pending.`);
    for (let i = 0; i < slice.items.length; i++) {
      const req = slice.items[i];
      form.button("request", labelFor(req), { iconPath: ICONS.menu, value: req.requestId });
    }
    if (slice.hasPrevious) form.button("previous", "Previous", { iconPath: ICONS.back });
    if (slice.hasNext) form.button("next", "Next", { iconPath: ICONS.back });
    form.back("Back", ICONS.back);

    const result = await form.show(player);
    if (TauUi.isCanceledOrBack(result)) return undefined;
    if (result.id === "previous" && slice.hasPrevious) {
      page--;
      continue;
    }
    if (result.id === "next" && slice.hasNext) {
      page++;
      continue;
    }
    if (result.value !== undefined) return result.value;
  }
}

async function notifyRequester(requesterName: string, allPlayers: Player[], message: string): Promise<void> {
  for (const candidate of allPlayers) {
    if (candidate.name === requesterName) {
      tell(candidate, message);
      return;
    }
  }
}

async function showInboxMenu(player: Player): Promise<void> {
  while (true) {
    const incoming = listIncomingTpaRequests(player);
    if (incoming.length === 0) {
      tell(player, "§7No pending incoming TPA requests.");
      return;
    }
    const requestId = await pickRequestId(
      player,
      "Incoming TPA Requests",
      incoming,
      (req) => formatIncomingLabel(req, Date.now()),
    );
    if (!requestId) return;

    const request = incoming.find((r) => r.requestId === requestId);
    if (!request) {
      tell(player, "§cThat request has expired or was handled.");
      continue;
    }

    const action = await TauUi.action<"accept" | "deny">("TPA Request")
      .body(`Accept or deny ${request.fromName}'s request?`)
      .button("accept", "Accept", { iconPath: ICONS.confirm, value: "accept" })
      .button("deny", "Deny", { iconPath: ICONS.delete, value: "deny" })
      .back("Back", ICONS.back)
      .show(player);

    if (TauUi.isCanceledOrBack(action)) continue;
    if (action.id === "accept") {
      const result = acceptTpaRequest(player, requestId);
      tell(player, result.message);
      if (result.ok && result.requesterName) {
        await notifyRequester(result.requesterName, world.getAllPlayers(), `§a${player.name} accepted your TPA request.`);
      }
      return;
    }
    if (action.id === "deny") {
      const confirmed = await TauUi.confirm(player, {
        title: "Deny TPA",
        body: "Deny this teleport request?",
        confirmText: "Deny",
        cancelText: "Cancel",
      });
      if (!confirmed) continue;
      const result = denyTpaRequest(player, requestId);
      tell(player, result.message);
      if (result.ok && result.requesterName) {
        await notifyRequester(result.requesterName, world.getAllPlayers(), `§c${player.name} denied your TPA request.`);
      }
      return;
    }
  }
}

async function showOutboxMenu(player: Player): Promise<void> {
  while (true) {
    const outgoing = listOutgoingTpaRequests(player);
    if (outgoing.length === 0) {
      tell(player, "§7No pending outgoing TPA requests.");
      return;
    }
    const requestId = await pickRequestId(
      player,
      "Outgoing TPA Requests",
      outgoing,
      (req) => formatOutgoingLabel(req, Date.now()),
    );
    if (!requestId) return;

    const request = outgoing.find((r) => r.requestId === requestId);
    if (!request) {
      tell(player, "§cThat request has expired or was handled.");
      continue;
    }
    const confirmed = await TauUi.confirm(player, {
      title: "Cancel TPA",
      body: `Cancel your TPA request to ${request.toName}?`,
      confirmText: "Cancel",
      cancelText: "Keep",
    });
    if (!confirmed) continue;
    const result = cancelOutgoingTpaRequest(player, requestId);
    tell(player, result.message);
    return;
  }
}

async function showSendTpaMenu(player: Player): Promise<void> {
  const target = await pickOnlinePlayer(player, "Send TPA");
  if (!target) return;
  const result = createTpaRequest(player, target);
  tell(player, result.message);
}

export async function showTpaHub(player: Player): Promise<void> {
  if (!state.tpa.config.enabled) {
    tell(player, "§cTPA is disabled on this server.");
    return;
  }
  if (state.config.features.tpa === false) {
    return;
  }

  while (true) {
    const incomingCount = listIncomingTpaRequests(player).length;
    const outgoingCount = listOutgoingTpaRequests(player).length;
    const form = TauUi.action("TPA")
      .body("Send and manage teleport requests.")
      .button("send", "Send Request", { iconPath: ICONS.confirm })
      .button("inbox", `Inbox (${incomingCount})`, { iconPath: ICONS.sidebar })
      .button("outbox", `Outbox (${outgoingCount})`, { iconPath: ICONS.menu })
      .back("Back", ICONS.back);

    const result = await form.show(player);
    if (TauUi.isCanceledOrBack(result)) return;
    if (result.id === "send") {
      await showSendTpaMenu(player);
      continue;
    }
    if (result.id === "inbox") {
      await showInboxMenu(player);
      continue;
    }
    if (result.id === "outbox") {
      await showOutboxMenu(player);
      continue;
    }
  }
}

export function handleIncomingTpaRequest(targetId: string, request: TpaRequest): void {
  if (!state.tpa.config.enabled || !state.tpa.config.notifyViaModal) return;
  const target: Player | undefined = world.getAllPlayers().find((p) => getPlayerId(p) === targetId);
  if (!target) return;
  const secondsLeft = Math.max(1, Math.ceil((request.expiresAt - Date.now()) / 1000));
  const body = `${request.fromName} wants to teleport to you. Expires in ${secondsLeft}s.`;
  system.run(() => {
    if (!target.isValid) return;
    tauMessage("TPA Request")
      .body(body)
      .button1("Accept")
      .button2("Deny")
      .show(target)
      .then((result) => {
        if (!target.isValid || result.canceled) return;
        if (result.selection === 0) {
          const acceptResult = acceptTpaRequest(target, request.requestId);
          tell(target, acceptResult.message);
        } else {
          const denyResult = denyTpaRequest(target, request.requestId);
          tell(target, denyResult.message);
        }
      })
      .catch(() => undefined);
  });
}

export function bootstrapTpaNotify(): void {
  registerTpaIncomingHandler((targetId, request) => {
    handleIncomingTpaRequest(targetId, request);
  });
}
