import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandRegistry,
  CustomCommandResult,
  system,
  world,
} from "@minecraft/server";
import { requirePlayerResult } from "./helpers";
import { getHelpLines } from "./help-topics";
import { commandOriginToPlayer, clearAllData, isFeatureEnabled, isOperator, saveShops, state, tell } from "../storage";
import { TAUUTILS_VERSION } from "../shared/version";

export function registerMetaCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand(
    {
      name: "tau:help",
      description: "Tau addon help system.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        {
          name: "topic",
          type: CustomCommandParamType.String,
        },
      ],
    },
    (origin, topic?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      const msg = (text: string) => { if (player) tell(player, text); };
      const topicKey = String(topic ?? "").trim().toLowerCase();

      const lines = getHelpLines(topicKey);
      for (const line of lines) {
        msg(line);
      }
      return { status: 0, message: "TauUI Help" };
    }
  );

  registry.registerCommand(
    {
      name: "tau:config",
      description: "Open Tau feature config.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("creator")) return { status: 1, message: "Creator is disabled." };
      system.run(async () => {
        const { showConfigMenu } = await import("../ui");
        showConfigMenu(player);
      });
      return { status: 0, message: "Opening Tau config." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:cleardata",
      description: "DEV: Clear all Tau UI data.",
      cheatsRequired: true,
      permissionLevel: CommandPermissionLevel.Admin,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      clearAllData();
      if (!state.shops.default) {
        state.shops.default = {
          id: "default",
          currencyObjective: "money",
          items: [],
        };
        saveShops();
      }
      const msg = "All Tau UI data cleared.";
      if (player) tell(player, msg);
      return { status: 0, message: msg };
    }
  );

  registry.registerCommand(
    {
      name: "tau:debugscore",
      description: "Check scoreboard objective and player score.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [
        {
          name: "objective",
          type: CustomCommandParamType.String,
        },
      ],
    },
    (origin, objectiveId?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      const msg = (text: string) => { if (player) tell(player, text); };
      const id = String(objectiveId ?? "").trim();
      if (!id) {
        return { status: 1, message: "Usage: /tau:debugscore <objective>" };
      }
      const objective = world.scoreboard.getObjective(id);
      if (!objective) {
        msg(`Objective "${id}" does not exist.`);
        return { status: 0, message: `Objective "${id}" not found.` };
      }
      msg(`Objective: §e${id}§r (display: §e${objective.displayName}§r)`);
      if (!player) {
        return { status: 0, message: `Objective "${id}" found.` };
      }
      const identity = player.scoreboardIdentity;
      if (!identity) {
        msg("Your scoreboard identity is not ready yet.");
        return { status: 0, message: "No identity." };
      }
      const score = objective.getScore(identity);
      msg(`Your score: §e${score ?? "none"}§r`);
      return { status: 0, message: `Score checked: ${score ?? "none"}` };
    }
  );

  registry.registerCommand(
    {
      name: "tau:credits",
      description: "Show TauUtils credits.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      const msg = (text: string) => {
        if (player) tell(player, text);
      };
      msg("§6--- TauUtils Credits ---");
      msg("§eCreator: §aRCodE777");
      msg(`§eVersion: §7${TAUUTILS_VERSION}`);
      msg("§7Thank you for using TauUtils!");
      return { status: 0, message: "Credits shown." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:richest",
      description: "List the top ten richest players.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        {
          name: "objective",
          type: CustomCommandParamType.String,
        },
      ],
    },
    (origin, objectiveId?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      const msg = (text: string) => {
        if (player) tell(player, text);
      };
      const id = String(objectiveId ?? "money").trim() || "money";
      const objective = world.scoreboard.getObjective(id);
      if (!objective) {
        return { status: 1, message: `Scoreboard objective "${id}" not found.` };
      }

      const topTen = world
        .getPlayers()
        .map((onlinePlayer) => {
          const identity = onlinePlayer.scoreboardIdentity;
          if (!identity) return undefined;
          let score = 0;
          try {
            score = objective.getScore(identity) ?? 0;
          } catch {
            score = 0;
          }
          return { name: onlinePlayer.name, score };
        })
        .filter((entry): entry is { name: string; score: number } => Boolean(entry))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, 10);

      if (player) {
        msg(`§6Top 10 richest players§7 (${id})`);
        if (topTen.length === 0) {
          msg("§7No player scores found.");
        } else {
          topTen.forEach((entry, index) => {
            msg(`§e${index + 1}.§7 ${entry.name} §f- §a${entry.score}`);
          });
        }
      }

      return { status: 0, message: `Listed top 10 from ${id}.` };
    }
  );

  registry.registerCommand(
    {
      name: "tau:rank",
      description: "Open rank manager.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "action", type: CustomCommandParamType.String },
      ],
    },
    (origin, action?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      const msg = (text: string) => { if (player) tell(player, text); };
      const act = String(action ?? "").trim().toLowerCase();

      if (!isFeatureEnabled("ranks")) {
        return { status: 1, message: "Ranks are disabled." };
      }

      if (act === "list") {
        const rankKeys = Object.keys(state.ranks.ranks);
        if (rankKeys.length === 0) {
          msg("§6--- Ranks ---");
          msg("§7No ranks created yet.");
          msg("§7Use §e/tau:creator§7 → Ranks to manage.");
        } else {
          msg("§6--- Ranks ---");
          for (const key of rankKeys) {
            const rank = state.ranks.ranks[key];
            msg(`§e${rank.id}§7 - ${rank.color}${rank.name}§r (priority: ${rank.priority})`);
          }
        }
        return { status: 0, message: "Rank list displayed." };
      }

      if (!player) {
        return { status: 1, message: "This command can only be used by a player." };
      }

      system.run(async () => {
        const { showRankMenu } = await import("../ui");
        showRankMenu(player);
      });
      return { status: 0, message: "Opening rank manager." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:profile",
      description: "View or edit a player profile.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "target", type: CustomCommandParamType.String },
      ],
    },
    (origin, target?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      const targetName = String(target ?? "").trim();
      if (!player && !targetName) return { status: 1, message: "Usage: /tau:profile <player>" };

      if (!isFeatureEnabled("profiles")) {
        return { status: 1, message: "Profiles are disabled." };
      }

      if (!targetName) {
        if (!player) return { status: 1, message: "Usage: /tau:profile <player>" };
        system.run(async () => {
          const { showProfileBrowser } = await import("../ui");
          showProfileBrowser(player);
        });
        return { status: 0, message: "Opening profile browser." };
      }

      const online = world.getAllPlayers().find((p) => p.name.toLowerCase() === targetName.toLowerCase());
      if (online && player && isOperator(player)) {
        system.run(async () => {
          const { showPlayerProfileEditor } = await import("../ui");
          showPlayerProfileEditor(player, online.name);
        });
        return { status: 0, message: `Opening profile editor for ${online.name}.` };
      }

      system.run(async () => {
        const { showPlayerProfileViewer } = await import("../ui");
        showPlayerProfileViewer(player ?? online, targetName);
      });
      return { status: 0, message: `Opening profile for ${targetName}.` };
    }
  );
}
