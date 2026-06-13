import { world } from "@minecraft/server";
import { flushPendingDynamicSaves } from "../storage";

export function registerLifecycleEvents(): void {
  const shutdownEvent = (world.beforeEvents as unknown as { shutdown?: { subscribe(callback: () => void): void } }).shutdown;
  shutdownEvent?.subscribe(() => {
    flushPendingDynamicSaves();
  });
}
