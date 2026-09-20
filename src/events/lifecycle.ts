import { world } from "@minecraft/server";
import { flushAllDirtyQueues } from "../storage";
import { registerBackgroundTask } from "../scheduler";

export function registerLifecycleEvents(): void {
  const shutdownEvent = (world.beforeEvents as unknown as { shutdown?: { subscribe(callback: () => void): void } }).shutdown;
  if (shutdownEvent) {
    shutdownEvent.subscribe(() => {
      flushAllDirtyQueues();
    });
    return;
  }
  // Fallback when the shutdown hook is absent: force-flush debounced dynamic
  // saves on an infrequent staggered interval so no dirty queue waits forever.
  registerBackgroundTask("lifecycle-shutdown-flush", 600, flushAllDirtyQueues, 2);
}
