export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A random delay in [minMs, maxMs]. Used to avoid uniform request patterns. */
export const jitter = (minMs: number, maxMs: number): number =>
  Math.floor(minMs + Math.random() * (maxMs - minMs));
