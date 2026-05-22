import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandRegistry,
  CustomCommandResult,
  system,
} from "@minecraft/server";
import { requirePlayerResult, requireFeatureResult } from "./helpers";
import { commandOriginToPlayer, isFeatureEnabled } from "../storage";
import { runBuiltCommand } from "../command-builder";

export function registerFormsCommands(registry: CustomCommandRegistry): void {
  registry.registerCommand(
    {
      name: "tau:cmd",
      description: "Run an admin Command Builder command by id.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [
        {
          name: "id",
          type: CustomCommandParamType.String,
        },
      ],
    },
    (origin, id: string): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
      const result = runBuiltCommand(player, id);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

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
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
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
      name: "tau:creator",
      description: "Open the Tau UI creator.",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (origin): CustomCommandResult => {
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
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
      const err = requirePlayerResult(origin);
      if (err) return err;
      const player = commandOriginToPlayer(origin)!;
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
}
