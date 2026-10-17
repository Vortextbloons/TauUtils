export const TAUUTILS_VERSION = "3.0.0-Beta";

export const IS_DEV = false;

export function formatTauUtilsLoadedMessage(): string {
  const suffix = IS_DEV ? "-dev" : "";
  return `§b§lTauUtils§r §aLoaded§r §7v§e${TAUUTILS_VERSION}${suffix}§r, Made By RCodE777`;
}
