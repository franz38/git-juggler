import type { Preferences } from "../api/types.ts";

/**
 * Batches preference changes into as few PUTs as possible: changes made within
 * `delayMs` of each other are merged (last write per key wins) and sent once.
 * A failed send is retried a few times; after that the values stay in
 * localStorage and are re-uploaded the next time the app loads.
 */
export function createPreferenceSender(
  send: (patch: Preferences) => Promise<unknown>,
  { delayMs = 300, retryMs = 5000, maxRetries = 3 } = {},
) {
  let pending: Preferences = {};
  let inFlight: Preferences = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;

  const schedule = (ms: number) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  };

  async function flush(): Promise<void> {
    timer = undefined;
    if (Object.keys(pending).length === 0) return;
    const batch = pending;
    pending = {};
    inFlight = batch;
    try {
      await send(batch);
      retries = 0;
    } catch {
      // Newer changes made meanwhile take precedence over the failed batch.
      pending = { ...batch, ...pending };
      if (retries++ < maxRetries) schedule(retryMs);
    } finally {
      inFlight = {};
    }
  }

  return {
    save(patch: Preferences): void {
      pending = { ...pending, ...patch };
      retries = 0;
      schedule(delayMs);
    },
    /** Keys changed locally whose upload hasn't completed yet. */
    unsentKeys(): string[] {
      return [...new Set([...Object.keys(pending), ...Object.keys(inFlight)])];
    },
    flush,
  };
}
