export const TAUUTILS_VERSION = "2.8.5-Beta";

export const IS_DEV = true;

export function formatTauUtilsLoadedMessage(): string {
  const suffix = IS_DEV ? "-dev" : "";
  return `§b§lTauUtils§r §aLoaded§r §7v§e${TAUUTILS_VERSION}${suffix}§r, Made By RCodE777`;
}
