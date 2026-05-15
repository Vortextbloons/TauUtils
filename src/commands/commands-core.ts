import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandResult,
  system,
  world,
} from "@minecraft/server";
import {
  clearAllData,
  commandOriginToPlayer,
  getPlayerId,
  isFeatureEnabled,
  isOperator,
  saveProfiles,
  saveShops,
  setPlayerStatById,
  getKnownPlayerIds,
  getProfileConfig,
  getPlayerStatsById,
  state,
  tell,
} from "../storage";
import { assignPlayerToSlot, autoBuildPlots, buildManualGridSlots, buildPlotGeometry, forceReleasePlot, getPlotStatusLines, setPlotCount, setPlotSize, setPlotSpacing, teleportPlayerToSlot, validatePlotLayout } from "../plots";
import { acceptTpaRequest, createTpaRequest, deleteHome, denyTpaRequest, listHomes, payPlayer, setHome, teleportHome } from "../social";
import { acceptTeamInvite, createTeam, disbandTeam, inviteToTeam, joinTeam, kickFromTeam, leaveTeam, getPlayerTeam } from "../teams";
import { pruneData, tellPruneResult } from "../prune";
import { listWarps } from "../warps";
import { addGeneratorTier, createGeneratorDefinition, giveGenerator } from "../generators";
import { listCrateIds } from "../crates";
import { listTauItemIds } from "../tau-items";
import { TAUUTILS_VERSION } from "../shared/version";

export function registerCustomCommands(
  startupEvent: { customCommandRegistry: { registerCommand: Function } }
) {
  const registry = startupEvent.customCommandRegistry;

  registry.registerCommand(
    {
      name: "tau:open",
      description: "Open a Tau menu by id.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [
        {
          name: "menu_id",
          type: CustomCommandParamType.String,
        },
      ],
    },
    (origin, menuId: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) {
        return {
          status: 1,
          message: "This command can only be used by a player.",
        };
      }
      const id = String(menuId ?? "").trim();
      if (!id) {
        return { status: 1, message: "Usage: /tau:open <menu_id>" };
      }
      if (!isFeatureEnabled("forms")) {
        return { status: 1, message: "Forms are disabled." };
      }
      system.run(async () => {
        const { openFormById } = await import("../ui");
        openFormById(player, id);
      });
      return { status: 0, message: `Opening ${id}.` };
    }
  );

  registry.registerCommand(
    {
      name: "tau:crate",
      description: "Manage crates and keys.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "action", type: CustomCommandParamType.String },
        { name: "crate", type: CustomCommandParamType.String },
        { name: "amount", type: CustomCommandParamType.String },
      ],
    },
    (origin, action?: string, crateArg?: string, amountArg?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("crates")) return { status: 1, message: "Crates are disabled." };
      if (!isOperator(player)) return { status: 1, message: "Operator required." };

      const actionKey = String(action ?? "").trim().toLowerCase();
      if (actionKey === "list") {
        const ids = listCrateIds();
        if (ids.length === 0) return { status: 0, message: "No crates configured." };
        for (const id of ids) tell(player, `§7- §e${id}`);
        return { status: 0, message: `Listed ${ids.length} crate id(s).` };
      }

      system.run(async () => {
        const { showCrateAdminMenu } = await import("../ui");
        showCrateAdminMenu(player);
      });
      return { status: 0, message: "Opening crate admin." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:item",
      description: "Manage Tau custom items.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "action", type: CustomCommandParamType.String }],
    },
    (origin, action?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("items")) return { status: 1, message: "TauItems are disabled." };
      if (!isOperator(player)) return { status: 1, message: "Operator required." };

      const actionKey = String(action ?? "").trim().toLowerCase();
      if (actionKey === "list") {
        const ids = listTauItemIds();
        if (ids.length === 0) return { status: 0, message: "No TauItems configured." };
        for (const id of ids) tell(player, `§7- §e${id}`);
        return { status: 0, message: `Listed ${ids.length} TauItem id(s).` };
      }

      system.run(async () => {
        const { showTauItemsAdminMenu } = await import("../ui");
        showTauItemsAdminMenu(player);
      });
      return { status: 0, message: "Opening TauItems admin." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:generatorsadmin",
      description: "Open generator admin menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isOperator(player)) return { status: 1, message: "Operator required." };
      if (!isFeatureEnabled("generators")) return { status: 1, message: "Generators are disabled." };
      system.run(async () => {
        const { showGeneratorAdminMenu } = await import("../ui");
        showGeneratorAdminMenu(player);
      });
      return { status: 0, message: "Opening generator admin menu." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:lootchests",
      description: "Open loot chest admin menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isOperator(player)) return { status: 1, message: "Operator required." };
      if (!isFeatureEnabled("lootChests")) return { status: 1, message: "Loot chests are disabled." };
      system.run(async () => {
        const { showLootChestsAdminMenu } = await import("../ui");
        showLootChestsAdminMenu(player);
      });
      return { status: 0, message: "Opening loot chest admin menu." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:dev_icon",
      description: "Open icon dev browser.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isOperator(player)) return { status: 1, message: "Operator required." };
      system.run(async () => {
        const { showIconDevMenu } = await import("../ui");
        showIconDevMenu(player);
      });
      return { status: 0, message: "Opening icon dev menu." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:warps",
      description: "Open warp menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("warps")) return { status: 1, message: "Warps are disabled." };
      system.run(async () => {
        const { showWarpMenu } = await import("../ui");
        showWarpMenu(player);
      });
      return { status: 0, message: "Opening warp menu." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:warpsadmin",
      description: "Open warp admin menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isOperator(player)) return { status: 1, message: "Operator required." };
      if (!isFeatureEnabled("warps")) return { status: 1, message: "Warps are disabled." };
      system.run(async () => {
        const { showWarpAdminMenu } = await import("../ui");
        showWarpAdminMenu(player);
      });
      return { status: 0, message: "Opening warp admin menu." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:warp",
      description: "Teleport to a warp or open warp menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "warp", type: CustomCommandParamType.String }],
    },
    (origin, warpName?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("warps")) return { status: 1, message: "Warps are disabled." };
      const name = String(warpName ?? "").trim();
      if (!name) {
        system.run(async () => {
          const { showWarpMenu } = await import("../ui");
          showWarpMenu(player);
        });
        return { status: 0, message: "Opening warp menu." };
      }
      const warp = listWarps().find((entry) => entry.id === name.toLowerCase() || entry.name.toLowerCase() === name.toLowerCase());
      if (!warp) return { status: 1, message: `Warp "${name}" not found.` };
      system.run(async () => {
        const { teleportToWarp } = await import("../warps");
        const result = teleportToWarp(player, warp.id);
        tell(player, result.message);
      });
      return { status: 0, message: `Teleporting to ${warp.name}.` };
    }
  );

  registry.registerCommand(
    {
      name: "tau:plot",
      description: "Open your plot info menu.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("plots")) return { status: 1, message: "Plots are disabled." };
      if (!isFeatureEnabled("plotTp")) return { status: 1, message: "Plot teleport is disabled." };
      system.run(async () => {
        const { showPlotPlayerMenu } = await import("../ui");
        showPlotPlayerMenu(player);
      });
      return { status: 0, message: "Opening plot menu." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:prune",
      description: "Preview or execute data pruning.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "action", type: CustomCommandParamType.String },
      ],
    },
    (origin, action?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isOperator(player)) return { status: 1, message: "Operator required." };
      if (!isFeatureEnabled("prune")) return { status: 1, message: "Prune is disabled." };

      const act = String(action ?? "").trim().toLowerCase();
      if (!act || act === "ui" || act === "menu" || act === "open") {
        system.run(async () => {
          const { showPruneDataMenu } = await import("../ui");
          showPruneDataMenu(player);
        });
        return { status: 0, message: "Opening prune menu." };
      }

      if (act === "dry" || act === "preview") {
        const result = pruneData(true);
        tellPruneResult(player, result, true);
        return { status: 0, message: `Previewed ${result.removed} removals.` };
      }

      if (act === "run" || act === "execute") {
        const result = pruneData(false);
        tellPruneResult(player, result, false);
        return { status: 0, message: `Pruned ${result.removed} entries.` };
      }

      return { status: 1, message: "Actions: ui, dry, run" };
    }
  );

  registry.registerCommand(
    {
      name: "tau:team",
      description: "Open team menu or manage teams.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "action", type: CustomCommandParamType.String },
        { name: "arg1", type: CustomCommandParamType.String },
      ],
    },
    (origin, action?: string, arg1?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("teams")) return { status: 1, message: "Teams are disabled." };

      const act = String(action ?? "").trim().toLowerCase();
      if (!act || act === "ui" || act === "menu" || act === "open") {
        system.run(async () => {
          const { showTeamMenu } = await import("../ui");
          showTeamMenu(player);
        });
        return { status: 0, message: "Opening team menu." };
      }

      if (act === "create") {
        const result = createTeam(player, String(arg1 ?? "").trim());
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "join") {
        const result = joinTeam(player, String(arg1 ?? "").trim());
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "leave") {
        const result = leaveTeam(player);
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "accept") {
        const result = acceptTeamInvite(player, String(arg1 ?? "").trim());
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "invite") {
        const team = getPlayerTeam(player);
        if (!team) return { status: 1, message: "You are not in a team." };
        const targetName = String(arg1 ?? "").trim();
        if (!targetName) return { status: 1, message: "Usage: /tau:team invite <player>" };
        const target = world.getAllPlayers().find((p) => p.name.toLowerCase() === targetName.toLowerCase());
        if (!target) return { status: 1, message: `Player "${targetName}" not online.` };
        const result = inviteToTeam(player, target);
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "kick") {
        const team = getPlayerTeam(player);
        if (!team) return { status: 1, message: "You are not in a team." };
        const targetName = String(arg1 ?? "").trim();
        if (!targetName) return { status: 1, message: "Usage: /tau:team kick <player>" };
        const target = world.getAllPlayers().find((p) => p.name.toLowerCase() === targetName.toLowerCase());
        if (!target) return { status: 1, message: `Player "${targetName}" not online.` };
        const result = kickFromTeam(player, target);
        return { status: result.ok ? 0 : 1, message: result.message };
      }
      if (act === "disband") {
        const result = disbandTeam(player);
        return { status: result.ok ? 0 : 1, message: result.message };
      }

      return { status: 1, message: "Actions: ui, create, join, leave, accept, invite, kick, disband" };
    }
  );

  registry.registerCommand(
    {
      name: "tau:tpa",
      description: "Send a teleport request to a player.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "target", type: CustomCommandParamType.String }],
    },
    (origin, target?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("tpa")) return { status: 1, message: "TPA is disabled." };

      const targetName = String(target ?? "").trim();
      if (!targetName) {
        system.run(async () => {
          const { showTpaMenu } = await import("../ui");
          showTpaMenu(player);
        });
        return { status: 0, message: "Opening TPA menu." };
      }

      const online = world.getAllPlayers().find((p) => p.name.toLowerCase() === targetName.toLowerCase());
      if (!online) return { status: 1, message: `Player "${targetName}" is not online.` };
      const result = createTpaRequest(player, online);
      if (result.ok) {
        tell(online, `§e${player.name} sent you a TPA request. Use /tau:tpaccept or /tau:tpdeny.`);
      }
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:tpaccept",
      description: "Accept latest TPA request.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("tpa")) return { status: 1, message: "TPA is disabled." };
      const result = acceptTpaRequest(player);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:tpdeny",
      description: "Deny latest TPA request.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("tpa")) return { status: 1, message: "TPA is disabled." };
      const result = denyTpaRequest(player);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:sethome",
      description: "Set a named home.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin, name?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("homes")) return { status: 1, message: "Homes are disabled." };
      const result = setHome(player, name);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:home",
      description: "Teleport to a home or open home UI.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin, name?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("homes")) return { status: 1, message: "Homes are disabled." };
      const homeName = String(name ?? "").trim();
      if (!homeName) {
        system.run(async () => {
          const { showHomesMenu } = await import("../ui");
          showHomesMenu(player);
        });
        return { status: 0, message: "Opening homes menu." };
      }
      const result = teleportHome(player, homeName);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:delhome",
      description: "Delete a named home.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin, name: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("homes")) return { status: 1, message: "Homes are disabled." };
      const result = deleteHome(player, name);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:homes",
      description: "List your homes.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("homes")) return { status: 1, message: "Homes are disabled." };
      const homes = listHomes(player);
      if (homes.length === 0) return { status: 0, message: "No homes set." };
      for (const home of homes) tell(player, `- ${home}`);
      return { status: 0, message: `Listed ${homes.length} homes.` };
    }
  );

  registry.registerCommand(
    {
      name: "tau:pay",
      description: "Pay another player.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "target", type: CustomCommandParamType.String },
        { name: "amount", type: CustomCommandParamType.String },
      ],
    },
    (origin, target?: string, amount?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("pay")) return { status: 1, message: "Pay is disabled." };

      const targetName = String(target ?? "").trim();
      if (!targetName) {
        system.run(async () => {
          const { showPayMenu } = await import("../ui");
          showPayMenu(player);
        });
        return { status: 0, message: "Opening pay menu." };
      }
      const online = world.getAllPlayers().find((p) => p.name.toLowerCase() === targetName.toLowerCase());
      if (!online) return { status: 1, message: `Player "${targetName}" is not online.` };
      const parsed = Number(String(amount ?? "").trim());
      if (!Number.isFinite(parsed)) return { status: 1, message: "Usage: /tau:pay <player> <amount>" };
      const result = payPlayer(player, online, parsed);
      if (result.ok) {
        tell(online, `§aYou received a payment from ${player.name}.`);
      }
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registry.registerCommand(
    {
      name: "tau:settings",
      description: "Open player social settings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("playerConfig")) return { status: 1, message: "Player config is disabled." };
      system.run(async () => {
        const { showPlayerSettingsMenu } = await import("../ui");
        showPlayerSettingsMenu(player);
      });
      return { status: 0, message: "Opening player settings." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:plots",
      description: "Open plot manager (admin).",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) return { status: 1, message: "This command can only be used by a player." };
      if (!isFeatureEnabled("plots")) return { status: 1, message: "Plots are disabled." };
      system.run(async () => {
        const { showPlotManager } = await import("../ui");
        showPlotManager(player);
      });
      return { status: 0, message: "Opening plot manager." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:stats",
      description: "View or edit player stats.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "target", type: CustomCommandParamType.String },
        { name: "stat", type: CustomCommandParamType.String },
        { name: "value", type: CustomCommandParamType.String },
      ],
    },
    (origin, target?: string, stat?: string, value?: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      const targetName = String(target ?? "").trim();
      if (!isFeatureEnabled("stats")) return { status: 1, message: "Stats are disabled." };
      if (!targetName) return { status: 1, message: "Usage: /tau:stats <player> [stat] [value]" };

      const matched = world.getAllPlayers().find((p) => p.name.toLowerCase() === targetName.toLowerCase());
      if (!stat) {
        system.run(async () => {
          const { showPlayerProfileViewer } = await import("../ui");
          showPlayerProfileViewer(player ?? matched, targetName);
        });
        return { status: 0, message: `Opened stats/profile for ${targetName}.` };
      }

      if (!player || !isOperator(player)) {
        return { status: 1, message: "Only operators can edit stats." };
      }

      if (!matched) return { status: 1, message: `Player "${targetName}" is not online.` };
      const parsed = Number(value ?? "");
      if (!Number.isFinite(parsed)) return { status: 1, message: "Value must be a number." };

      setPlayerStatById(getPlayerId(matched), stat as any, parsed);
      return { status: 0, message: `Set ${stat} for ${targetName} to ${parsed}.` };
    }
  );

  registry.registerCommand(
    {
      name: "tau:creator",
      description: "Open the Tau UI creator.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) {
        return {
          status: 1,
          message: "This command can only be used by a player.",
        };
      }
      if (!isFeatureEnabled("creator")) {
        return { status: 1, message: "Creator is disabled." };
      }
      system.run(async () => {
        const { showCreatorMenu } = await import("../ui");
        showCreatorMenu(player);
      });
      return { status: 0, message: "Opening Tau UI creator." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:sidebar",
      description: "Open sidebar editor (admin).",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) {
        return {
          status: 1,
          message: "This command can only be used by a player.",
        };
      }
      if (!isFeatureEnabled("sidebars")) {
        return { status: 1, message: "Sidebars are disabled." };
      }
      system.run(async () => {
        const { showSidebarEditor } = await import("../sidebar");
        await showSidebarEditor(player);
      });
      return { status: 0, message: "Opening sidebar editor." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:shop",
      description: "Open a Tau shop profile.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [
        {
          name: "profile_id",
          type: CustomCommandParamType.String,
        },
      ],
    },
    (origin, profileId: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) {
        return {
          status: 1,
          message: "This command can only be used by a player.",
        };
      }
      if (!isFeatureEnabled("shops")) {
        return { status: 1, message: "Shops are disabled." };
      }
      const id = String(profileId ?? "").trim() || "default";
      system.run(async () => {
        const { openShopProfile } = await import("../shop");
        await openShopProfile(player, id);
      });
      return { status: 0, message: `Opening shop profile ${id}.` };
    }
  );

  registry.registerCommand(
    {
      name: "tau:myshop",
      description: "Open your player shop manager.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) {
        return {
          status: 1,
          message: "This command can only be used by a player.",
        };
      }
      if (!isFeatureEnabled("shops")) {
        return { status: 1, message: "Shops are disabled." };
      }
      system.run(async () => {
        const { openMyPlayerShop } = await import("../player-shops");
        await openMyPlayerShop(player);
      });
      return { status: 0, message: "Opening your player shop." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:market",
      description: "Browse player marketplace listings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) {
        return {
          status: 1,
          message: "This command can only be used by a player.",
        };
      }
      if (!isFeatureEnabled("shops")) {
        return { status: 1, message: "Shops are disabled." };
      }
      system.run(async () => {
        const { openPlayerMarketplace } = await import("../player-shops");
        await openPlayerMarketplace(player);
      });
      return { status: 0, message: "Opening player marketplace." };
    }
  );

  registry.registerCommand(
    {
      name: "tau:shopadmin",
      description: "Open player shop admin settings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) {
        return {
          status: 1,
          message: "This command can only be used by a player.",
        };
      }
      if (!isFeatureEnabled("shops")) {
        return { status: 1, message: "Shops are disabled." };
      }
      if (!isOperator(player)) {
        return { status: 1, message: "Operator required." };
      }
      system.run(async () => {
        const { openPlayerShopAdmin } = await import("../player-shops");
        await openPlayerShopAdmin(player);
      });
      return { status: 0, message: "Opening player shop admin settings." };
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

      const topics: Record<string, string[]> = {
        "": [
          "§6TauUI Help §7- Available topics:",
          "§e/tau help commands §7- List all commands",
          "§e/tau help shop §7- Shop system guide",
          "§e/tau help sidebar §7- Sidebar system guide",
          "§e/tau help menus §7- Menu/form system guide",
          "§e/tau help bindings §7- Item/entity binding guide",
          "§e/tau help ranks §7- Rank & chat formatting",
          "§e/tau help stats §7- Player stats & profiles",
          "§e/tau help social §7- TPA, homes, pay, settings",
          "§e/tau help teams §7- Team system",
          "§e/tau help warps §7- Server warps",
          "§e/tau help plots §7- Plot system",
          "§e/tau help generators §7- Generator system",
          "§e/tau help crates §7- Crate system",
          "§e/tau help items §7- Custom Tau items",
          "§e/tau help prune §7- Data pruning",
          "§e/tau help areas §7- Custom areas",
          "§e/tau help placeholders §7- Available placeholders",
          "§7Use §e/tau help <topic>§7 for details.",
        ],
        commands: [
          "§6--- Commands ---",
          "§e/tau:open <menu_id> §7- Open a saved menu",
          "§e/tau:shop <profile> §7- Open a shop profile",
          "§e/tau:myshop §7- Manage your player-run shop",
          "§e/tau:market §7- Browse public player listings",
          "§e/tau:shopadmin §7- Player shop admin settings (op)",
          "§e/tau:shopclaim §7- Claim offline player-shop earnings",
          "§e/tau:config §7- Open feature config (op)",
          "§e/tau:creator §7- Open admin UI creator (op)",
          "§e/tau:sidebar §7- Open sidebar editor (op)",
          "§e/tau:warp [name] §7- Teleport to warp or open menu",
          "§e/tau:warps §7- Open warp list",
          "§e/tau:warpsadmin §7- Open warp admin menu (op)",
          "§e/tau:plot §7- Open your plot info/teleport menu",
          "§e/tau:plots §7- Open plot admin menu (op)",
          "§e/tau:generatorsadmin §7- Open generator admin (op)",
          "§e/tau:crate §7- Open crate admin (op)",
          "§e/tau:item §7- Open TauItems admin (op)",
          "§e/tau:lootchests §7- Open loot chest admin (op)",
          "§e/tau:rank §7- Open rank manager (op)",
          "§e/tau:profile §7- Open profile browser",
          "§e/tau:stats §7- View or edit stats",
          "§e/tau:richest §7- View richest players",
          "§e/tau:help [topic] §7- Show this help",
          "§e/tau:cleardata §7- Wipe all Tau data (op)",
          "§e/tau:debugscore <obj> §7- Debug scoreboard score",
          "§e/tau:credits §7- Show credits",
        ],
        shop: [
          "§6--- Shop System ---",
          "§e1.§7 Create a shop profile in §e/tau:creator§7 → Shop Profiles",
          "§e2.§7 Set the §ecurrency objective§7 (e.g. money)",
          "§e3.§7 Add items with §ebuy/sell prices§7 and quantities",
          "§e4.§7 Open the shop: §e/tau:shop <profile_id>",
          "§e5.§7 Bind to a menu button: §eshop transaction§7 action",
          "§7Value format: §e<profile>|key:<item_key>§7 or §ekey:<item_key>§7",
          "§7Player shops: §e/tau:myshop§7 and §e/tau:market§7 (escrow custom items).",
        ],
        warps: [
          "§6--- Warps ---",
          "§e/tau:warps §7- Open the warp list",
          "§e/tau:warp <name> §7- Teleport to a warp",
          "§e/tau:warpsadmin §7- Manage warps (op)",
          "§7Features: cross-dimension, categories, admin-managed.",
          "§7Admin: create at your position, set location, delete.",
        ],
        plots: [
          "§6--- Plots ---",
          "§e/tau:plot §7- Open your plot info/teleport menu",
          "§e/tau:plots §7- Open plot admin menu (op)",
          "§7Player: view plot info, teleport to your plot.",
          "§7Admin: set origin, size, spacing, count, auto-build.",
          "§7Auto-build: borders, floor, barrier roof.",
          "§7Team plots: owner holds the plot for the team.",
          "§7Snapshots save/restore player builds automatically.",
        ],
        generators: [
          "§6--- Generators ---",
          "§e/tau:generatorsadmin §7- Open generator admin (op)",
          "§7Place a generator block to start generating items.",
          "§7Upgrade tiers to increase output rate.",
          "§7Auto breakers can be purchased to auto-collect.",
          "§7Generators save with plot snapshots.",
        ],
        crates: [
          "§6--- Crates ---",
          "§e/tau:crate §7- Open crate admin (op)",
          "§7Configure crate blocks, keys, rewards, and animations.",
          "§7Give keys to players and let them open at crate blocks.",
          "§7Supports item, score, and tag rewards with weights.",
        ],
        items: [
          "§6--- Custom Tau Items ---",
          "§e/tau:item §7- Open TauItems admin (op)",
          "§7Create custom items with triggers (use, hit, mine).",
          "§7Bind commands, sounds, or effects to item usage.",
          "§7Supports costs (money, XP, health) and consumption modes.",
        ],
        sidebar: [
          "§6--- Sidebar System ---",
          "§e1.§7 Open §e/tau:sidebar§7 (or creator → Sidebar)",
          "§e2.§7 Create a sidebar and set §eupdate interval§7 (ticks)",
          "§e3.§7 Add lines with §eplaceholders§7 like §e[name]§7 or §e[money]",
          "§e4.§7 Tag players §esidebar:<id>§7 to bind them",
          "§e5.§7 Set §epriority§7 for conflict resolution",
          "§7Placeholders: §e[name] [money] [health] [ping] [pos] [tps] [rank_tag]",
        ],
        menus: [
          "§6--- Menu / Form System ---",
          "§e1.§7 Create a form in §e/tau:creator",
          "§e2.§7 Choose §eAction Form§7 (buttons) or §eModal Form§7 (inputs)",
          "§e3.§7 Add elements and bind them to actions",
          "§eAction types:",
          "  §eCOMMAND_PLAYER§7 - Run command as player",
          "  §eCOMMAND_SUDO§7 - Run command as console",
          "  §eOPEN_MENU§7 - Open another menu",
          "  §eSHOP_TRANSACTION§7 - Buy/sell shop item",
          "  §eCLOSE§7 - Close the UI",
        ],
        bindings: [
          "§6--- Binding System ---",
          "§eItem binds:§7 Bind a menu to an item type id",
          "  Use creator → Bindings → Set item bind",
          "§eLore binds:§7 Match menu by item lore text",
          "  Use creator → Bindings → Set item lore bind",
          "§eEntity binds:§7 Tag NPCs with §emenuid:<id>",
          "  Or: Bindings → Set entity-tag bind",
          "§eScriptevent:§7 §e/scriptevent tau open <id>",
        ],
        ranks: [
          "§6--- Ranks & Chat Formatting ---",
          "§e/tau:config §7- Toggle ranks feature",
          "§e/tau:creator §7- Manage ranks (op)",
          "§7Each rank has: color, prefix, suffix, permissions, chat format.",
          "§7Chat placeholders: §e[name] [rank] [rank_prefix] [rank_suffix] [team] [money] [message]",
          "§7Default rank auto-assigned to new players.",
        ],
        stats: [
          "§6--- Stats & Profiles ---",
          "§e/tau:stats <player> [stat] [value] §7- View/edit stats (op)",
          "§7Tracked: kills, deaths, killstreak, blocks placed/broken,",
          "  time played, distance traveled.",
          "§7Profiles: customizable player info cards.",
          "§7Use §e/tau:creator §7to edit profile visibility settings.",
        ],
        social: [
          "§6--- Social Features ---",
          "§e/tau:tpa [player] §7- Send/accept/deny teleport requests",
          "§e/tau:tpaccept §7- Accept latest TPA request",
          "§e/tau:tpdeny §7- Deny latest TPA request",
          "§e/tau:sethome [name] §7- Set a named home",
          "§e/tau:home [name] §7- Teleport to a home",
          "§e/tau:delhome <name> §7- Delete a home",
          "§e/tau:homes §7- List your homes",
          "§e/tau:pay <player> <amount> §7- Pay another player",
          "§e/tau:settings §7- Open your social settings",
          "§7Player settings: allow TPA, allow pay, show messages.",
          "§7Admin: social settings in §e/tau:config§7.",
        ],
        teams: [
          "§6--- Teams ---",
          "§e/tau:team §7- Open team menu",
          "§e/tau:team create <name> §7- Create a team",
          "§e/tau:team join <name> §7- Join a team (invite-only)",
          "§e/tau:team leave §7- Leave your team",
          "§e/tau:team invite <player> §7- Invite a player (owner)",
          "§e/tau:team kick <player> §7- Kick a member (owner)",
          "§e/tau:team disband §7- Disband your team (owner)",
          "§7Features: friendly fire toggle, team plot toggle.",
          "§7Team plot: owner holds the plot, members share it.",
        ],
        prune: [
          "§6--- Data Pruning ---",
          "§e/tau:prune §7- Open prune menu (op)",
          "§e/tau:prune dry §7- Preview what would be removed",
          "§e/tau:prune run §7- Execute the prune",
          "§7Prune by category: stats, profiles, teams, plots,",
          "  homes, tpa, pay, player settings.",
          "§7Uses inactivity window (default 30 days).",
        ],
        placeholders: [
          "§6--- Available Placeholders ---",
          "§e[name] §7- Player name",
          "§e[rank] §7- Player rank with color",
          "§e[rank_prefix] §7- Rank prefix",
          "§e[rank_suffix] §7- Rank suffix",
          "§e[team] §7- Team tag (if in a team)",
          "§e[money] §7- Scoreboard currency",
          "§e[health] §7- Player health",
          "§e[health_color] §7- Red(<5) / Orange(<10) / Green",
          "§e[ping] §7- Network latency",
          "§e[pos] §7- X, Y, Z coordinates",
          "§e[tps] §7- Server tick rate",
          "§e[rank_tag] §7- Player rank (static)",
          "§e[message] §7- Chat message",
          "§7Use §e[placeholder]§7 in sidebar lines, chat format, or form values",
        ],
        areas: [
          "§6--- Custom Areas ---",
          "§7Custom areas let you define 3D regions with special rules.",
          "§7Configure them in §e/tau:creator§7 → Custom Areas.",
          "§7Each area can have:",
          "§e  •§7 Enter/leave messages (chat or global)",
          "§e  •§7 Permission overrides: PvP, block break/place, item use, entity interact",
          "§e  •§7 Periodic effects (any potion effect on interval)",
          "§e  •§7 Periodic command rules (commands on interval per player)",
          "§e  •§7 Rank filters (who is affected)",
          "§e  •§7 Ticking area support (manual apply)",
          "§7Operators bypass custom-area block restrictions.",
        ],
      };

      const lines = topics[topicKey] ?? topics[""];
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
      name: "tau:shopclaim",
      description: "Claim offline player-shop earnings.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin);
      if (!player) {
        return {
          status: 1,
          message: "This command can only be used by a player.",
        };
      }
      if (!isFeatureEnabled("shops")) {
        return { status: 1, message: "Shops are disabled." };
      }
      system.run(async () => {
        const { claimPlayerShopEarnings } = await import("../player-shops");
        const result = claimPlayerShopEarnings(player);
        tell(player, result.ok ? result.message : `§e${result.message}`);
      });
      return { status: 0, message: "Claiming player-shop earnings." };
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
