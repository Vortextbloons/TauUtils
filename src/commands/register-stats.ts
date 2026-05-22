import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandRegistry,
  CustomCommandResult,
  system,
  world,
} from "@minecraft/server";
import { commandOriginToPlayer, getPlayerId, isFeatureEnabled, isOperator, setPlayerStatById, tell } from "../storage";

export function registerStatsCommands(registry: CustomCommandRegistry): void {
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
}
