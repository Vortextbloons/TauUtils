export function safeCall<T>(fn: () => T, fallback: T): T;
export function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T>;
export function safeCall<T>(fn: () => T | Promise<T>, fallback: T): T | Promise<T> {
  try {
    const result = fn();
    if (result && typeof (result as { then?: unknown }).then === "function") {
      return (result as Promise<T>).catch(() => fallback);
    }
    return result;
  } catch {
    return fallback;
  }
}
