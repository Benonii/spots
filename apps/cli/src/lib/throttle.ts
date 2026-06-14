export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A random delay in [minMs, maxMs]. Used to avoid uniform request patterns. */
export const jitter = (minMs: number, maxMs: number): number =>
  Math.floor(minMs + Math.random() * (maxMs - minMs));

/**
 * Returns a `gate()` that spaces calls to at most `perMinute` starts per minute,
 * regardless of how many callers await it concurrently. Used to keep the geocode
 * stage under Google Places' per-minute quota.
 */
export function rateLimiter(perMinute: number): () => Promise<void> {
  const intervalMs = 60000 / Math.max(1, perMinute);
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + intervalMs;
    if (wait > 0) await sleep(wait);
  };
}
