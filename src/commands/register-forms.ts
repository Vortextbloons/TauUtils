import {
  CustomCommandRegistry,
  CustomCommandResult,
  system,
} from "@minecraft/server";
import { requireOperatorResult } from "./helpers";
import { registerDescribedCommand } from "./descriptors";
import { commandOriginToPlayer, isFeatureEnabled } from "../storage";
import { runBuiltCommand } from "../command-builder";

export function registerFormsCommands(registry: CustomCommandRegistry): void {
  registerDescribedCommand(
    registry,
    "tau:cmd",
    (origin, id: string): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      const result = runBuiltCommand(player, id);
      return { status: result.ok ? 0 : 1, message: result.message };
    }
  );

  registerDescribedCommand(
    registry,
    "tau:open",
    (origin, menuId: string): CustomCommandResult => {
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

  registerDescribedCommand(
    registry,
    "tau:creator",
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
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

  registerDescribedCommand(
    registry,
    "tau:sidebar",
    (origin): CustomCommandResult => {
      const player = commandOriginToPlayer(origin)!;
      const opErr = requireOperatorResult(player);
      if (opErr) return opErr;
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
