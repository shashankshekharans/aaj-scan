export interface WakeLockHandle {
  release(): Promise<void>;
}

/**
 * Keeps the screen on while a batch is processed. Best effort: browsers refuse
 * the lock in battery saver, hidden tabs or under a permissions policy, and
 * processing must continue either way.
 */
export async function requestWakeLock(): Promise<WakeLockHandle | undefined> {
  const api = (navigator as Navigator & { wakeLock?: { request(type?: "screen"): Promise<WakeLockHandle> } }).wakeLock;
  try {
    return await api?.request("screen");
  } catch {
    return undefined;
  }
}
