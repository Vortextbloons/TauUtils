import { CommandPermissionLevel, CustomCommandParamType, type CustomCommandRegistry, type CustomCommandResult, type Entity } from "@minecraft/server";
import type { ConfigStore } from "../types";
import { commandOriginToPlayer } from "../storage";

export type HelpParam = {
  name: string;
  required: boolean;
};

export type CommandDescriptor = {
  name: `tau:${string}`;
  description: string;
  feature?: keyof ConfigStore["features"];
  requiresPlayer: boolean;
  requiresOperator: boolean;
  helpTopic: string;
  params: HelpParam[];
  usage: string;
};

function d(
  name: `tau:${string}`,
  description: string,
  helpTopic: string,
  usage: string,
  opts: Partial<Pick<CommandDescriptor, "feature" | "requiresPlayer" | "requiresOperator" | "params">> = {}
): CommandDescriptor {
  return {
    name,
    description,
    helpTopic,
    usage,
    feature: opts.feature,
    requiresPlayer: opts.requiresPlayer ?? true,
    requiresOperator: opts.requiresOperator ?? false,
    params: opts.params ?? [],
  };
}

export const COMMAND_DESCRIPTORS: readonly CommandDescriptor[] = [
  d("tau:help", "Show help", "commands", "/tau:help [topic]", { requiresPlayer: false, params: [{ name: "topic", required: false }] }),
  d("tau:config", "Open feature config (op)", "commands", "/tau:config", { feature: "creator", requiresOperator: true }),
  d("tau:cleardata", "Wipe all Tau data (op)", "commands", "/tau:cleardata", { requiresPlayer: false, requiresOperator: true }),
  d("tau:debugscore", "Debug scoreboard score", "commands", "/tau:debugscore <objective>", { requiresPlayer: false, params: [{ name: "objective", required: true }] }),
  d("tau:credits", "Show credits", "commands", "/tau:credits", { requiresPlayer: false }),
  d("tau:richest", "View richest players", "stats", "/tau:richest [objective]", { feature: "stats", requiresPlayer: false, params: [{ name: "objective", required: false }] }),
  d("tau:rank", "Open rank manager (op)", "ranks", "/tau:rank [action]", { requiresPlayer: false, requiresOperator: true, feature: "ranks", params: [{ name: "action", required: false }] }),
  d("tau:profile", "Open profile browser", "stats", "/tau:profile [player]", { feature: "profiles", requiresPlayer: false, params: [{ name: "target", required: false }] }),
  d("tau:stats", "View or edit stats", "stats", "/tau:stats <player> [stat] [value]", { feature: "stats", requiresPlayer: false, params: [{ name: "target", required: false }, { name: "stat", required: false }, { name: "value", required: false }] }),
  d("tau:cmd", "Run an admin Command Builder command by id", "commandbuilder", "/tau:cmd <id>", { params: [{ name: "id", required: true }] }),
  d("tau:open", "Open a Tau menu by id", "menus", "/tau:open <menu_id>", { feature: "forms", params: [{ name: "menu_id", required: true }] }),
  d("tau:creator", "Open the Tau UI creator", "menus", "/tau:creator", { feature: "creator", requiresOperator: true }),
  d("tau:sidebar", "Open sidebar editor (admin)", "sidebar", "/tau:sidebar", { feature: "sidebars", requiresOperator: true }),
  d("tau:shop", "Open a shop profile", "shop", "/tau:shop <profile_id>", { feature: "shops", params: [{ name: "profile_id", required: true }] }),
  d("tau:myshop", "Manage your player-run shop", "shop", "/tau:myshop", { feature: "playerShops" }),
  d("tau:market", "Browse public player listings", "shop", "/tau:market", { feature: "playerShops" }),
  d("tau:shopadmin", "Player shop admin settings (op)", "shop", "/tau:shopadmin", { feature: "playerShops", requiresOperator: true }),
  d("tau:shopclaim", "Claim offline player-shop earnings", "shop", "/tau:shopclaim", { feature: "playerShops" }),
  d("tau:tpa", "TPA request", "social", "/tau:tpa [player]", { feature: "tpa", params: [{ name: "target", required: false }] }),
  d("tau:tpaccept", "Accept TPA", "social", "/tau:tpaccept [requestId]", { feature: "tpa", params: [{ name: "requestId", required: false }] }),
  d("tau:tpdeny", "Deny TPA", "social", "/tau:tpdeny [requestId]", { feature: "tpa", params: [{ name: "requestId", required: false }] }),
  d("tau:tpacancel", "Cancel TPA", "social", "/tau:tpacancel <requestId>", { feature: "tpa", params: [{ name: "requestId", required: true }] }),
  d("tau:sethome", "Set home", "social", "/tau:sethome [name]", { feature: "homes", params: [{ name: "name", required: false }] }),
  d("tau:home", "Teleport home", "social", "/tau:home [name]", { feature: "homes", params: [{ name: "name", required: false }] }),
  d("tau:delhome", "Delete home", "social", "/tau:delhome <name>", { feature: "homes", params: [{ name: "name", required: true }] }),
  d("tau:pay", "Pay another player", "social", "/tau:pay [player] [amount]", { feature: "pay", params: [{ name: "target", required: false }, { name: "amount", required: false }] }),
  d("tau:settings", "Player settings", "social", "/tau:settings", { feature: "playerConfig" }),
  d("tau:team", "Team commands", "teams", "/tau:team [action] [arg1]", { feature: "teams", params: [{ name: "action", required: false }, { name: "arg1", required: false }] }),
  d("tau:teamsethome", "Set team home", "teams", "/tau:teamsethome [name]", { feature: "teamHomes", params: [{ name: "name", required: false }] }),
  d("tau:teamhome", "Teleport to team home", "teams", "/tau:teamhome [name]", { feature: "teamHomes", params: [{ name: "name", required: false }] }),
  d("tau:delteamhome", "Delete team home", "teams", "/tau:delteamhome <name>", { feature: "teamHomes", params: [{ name: "name", required: true }] }),
  d("tau:plot", "Open your plot menu", "plots", "/tau:plot", { feature: "plots" }),
  d("tau:plots", "Open plot admin menu (op)", "plots", "/tau:plots", { feature: "plots", requiresOperator: true }),
  d("tau:claim", "Open your claims menu", "areas", "/tau:claim", { feature: "claims" }),
  d("tau:claims", "Open claims admin menu", "areas", "/tau:claims", { feature: "claims", requiresOperator: true }),
  d("tau:warp", "Teleport to warp or open menu", "warps", "/tau:warp [warp]", { feature: "warps", params: [{ name: "warp", required: false }] }),
  d("tau:warps", "Warp list (alias path)", "warps", "/tau:warps", { feature: "warps" }),
  d("tau:warpsadmin", "Open warp admin menu (op)", "warps", "/tau:warpsadmin", { feature: "warps", requiresOperator: true }),
  d("tau:rtp", "Random teleport", "warps", "/tau:rtp [region]", { feature: "rtp", params: [{ name: "region", required: false }] }),
  d("tau:rtpadmin", "Open RTP admin menu", "warps", "/tau:rtpadmin", { requiresOperator: true }),
  d("tau:generatorsadmin", "Open generator admin (op)", "generators", "/tau:generatorsadmin", { feature: "generators", requiresOperator: true }),
  d("tau:crate", "Open crate admin (op)", "crates", "/tau:crate [action] [crate] [amount]", { feature: "crates", requiresOperator: true, params: [{ name: "action", required: false }, { name: "crate", required: false }, { name: "amount", required: false }] }),
  d("tau:item", "Open TauItems admin (op)", "items", "/tau:item [action]", { feature: "items", requiresOperator: true, params: [{ name: "action", required: false }] }),
  d("tau:lootchests", "Open loot chest admin (op)", "lootchests", "/tau:lootchests", { feature: "lootChests", requiresOperator: true }),
  d("tau:dev_icon", "Dev icon picker", "commands", "/tau:dev_icon", { requiresOperator: true }),
  d("tau:prune", "Data pruning", "prune", "/tau:prune [action]", { feature: "prune", requiresOperator: true, params: [{ name: "action", required: false }] }),
  d("tau:reward", "Reward commands", "commandbuilder", "/tau:reward [id]", { feature: "customRewards", params: [{ name: "id", required: false }] }),
  d("tau:referral", "Referral commands", "commandbuilder", "/tau:referral [code]", { feature: "referrals", params: [{ name: "code", required: false }] }),
  d("tau:referrals", "Referral admin", "commandbuilder", "/tau:referrals", { feature: "referrals", requiresOperator: true }),
];

export function getCommandDescriptor(name: `tau:${string}`): CommandDescriptor | undefined {
  return COMMAND_DESCRIPTORS.find((entry) => entry.name === name);
}

type DescribedCommandOrigin = { sourceEntity?: Entity; initiator?: Entity };
type DescribedCommandCallback = Parameters<CustomCommandRegistry["registerCommand"]>[1];

export type DescribedCommandOptions = {
  cheatsRequired?: boolean;
  permissionLevel?: CommandPermissionLevel;
};

// Builds the Bedrock command spec (name, description, mandatory/optional string
// params) from COMMAND_DESCRIPTORS and applies the descriptor's requiresPlayer
// gate (player-only message). Feature and operator gates
// stay explicit in each handler so existing messages and ordering are preserved.
export function registerDescribedCommand<TArgs extends unknown[]>(
  registry: CustomCommandRegistry,
  name: CommandDescriptor["name"],
  handler: (origin: DescribedCommandOrigin, ...args: TArgs) => CustomCommandResult,
  opts: DescribedCommandOptions = {},
): void {
  const descriptor = getCommandDescriptor(name);
  if (!descriptor) throw new Error(`[TauUtils] Missing command descriptor for ${name}.`);
  const mandatory = descriptor.params
    .filter((param) => param.required)
    .map((param) => ({ name: param.name, type: CustomCommandParamType.String }));
  const optional = descriptor.params
    .filter((param) => !param.required)
    .map((param) => ({ name: param.name, type: CustomCommandParamType.String }));
  const callback = ((origin: DescribedCommandOrigin, ...args: TArgs): CustomCommandResult => {
    if (descriptor.requiresPlayer && !commandOriginToPlayer(origin)) {
      return { status: 1, message: "This command can only be used by a player." };
    }
    return handler(origin, ...args);
  }) as DescribedCommandCallback;
  registry.registerCommand(
    {
      name: descriptor.name,
      description: descriptor.description,
      cheatsRequired: opts.cheatsRequired ?? false,
      permissionLevel: opts.permissionLevel ?? CommandPermissionLevel.Any,
      ...(mandatory.length > 0 ? { mandatoryParameters: mandatory } : {}),
      ...(optional.length > 0 ? { optionalParameters: optional } : {}),
    },
    callback,
  );
}
