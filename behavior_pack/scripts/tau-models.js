export const STORAGE_KEYS = {
    forms: "tau:forms",
    shops: "tau:shops",
    binds: "tau:binds",
    sidebars: "tau:sidebars",
    config: "tau:config",
    combat: "tau:combat",
    ranks: "tau:ranks",
    chat: "tau:chat",
    plots: "tau:plots",
    tpa: "tau:tpa",
    homes: "tau:homes",
    pay: "tau:pay",
    playerSettings: "tau:player_settings",
    teams: "tau:teams",
    warps: "tau:warps",
    generators: "tau:generators",
    moderation: "tau:moderation",
    crates: "tau:crates",
    tauItems: "tau:items",
    playerShops: "tau:player_shops",
};
export const CHAT_PREFIX = "§6[TauUI]§r";
export const RANK_COLORS = [
    "Black", "Dark Blue", "Dark Green", "Dark Aqua", "Dark Red", "Dark Purple",
    "Gold", "Gray", "Dark Gray", "Blue", "Green", "Aqua", "Red", "Light Purple",
    "Yellow", "White",
];
export const RANK_COLOR_CODES = {
    "Black": "§0", "Dark Blue": "§1", "Dark Green": "§2", "Dark Aqua": "§3",
    "Dark Red": "§4", "Dark Purple": "§5", "Gold": "§6", "Gray": "§7",
    "Dark Gray": "§8", "Blue": "§9", "Green": "§a", "Aqua": "§b",
    "Red": "§c", "Light Purple": "§d", "Yellow": "§e", "White": "§f",
};
export const CODE_TO_COLOR_NAME = {
    "§0": "Black", "§1": "Dark Blue", "§2": "Dark Green", "§3": "Dark Aqua",
    "§4": "Dark Red", "§5": "Dark Purple", "§6": "Gold", "§7": "Gray",
    "§8": "Dark Gray", "§9": "Blue", "§a": "Green", "§b": "Aqua",
    "§c": "Red", "§d": "Light Purple", "§e": "Yellow", "§f": "White",
};
export const CHAT_TEMPLATE_PLACEHOLDERS = [
    "[name]",
    "[rank]",
    "[rank_prefix]",
    "[rank_suffix]",
    "[team]",
    "[money]",
    "[message]",
];
export { ICONS, WORKING_ICON_OPTIONS, ICON_DEV_OPTIONS, WORKING_ICON_PATHS, isWorkingIconPath } from "./icons";
export const ACTION_TYPES = [
    "COMMAND_PLAYER",
    "COMMAND_SUDO",
    "OPEN_MENU",
    "CLOSE",
    "SHOP_TRANSACTION",
];
export const RESTRICTED_PLAYER_COMMANDS = new Set([
    "op",
    "deop",
    "stop",
    "reload",
    "whitelist",
    "permissions",
    "ban",
    "kick",
]);
