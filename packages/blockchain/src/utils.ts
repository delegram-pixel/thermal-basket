/**
 * Small async and collection helpers.
 *
 * A dependency-free module on purpose: these run in both the server and the
 * client bundle, and a utility that pulls in a library for `mapLimit` is a
 * utility that costs every visitor a few kilobytes.
 */

/**
 * Runs `worker` over `items`, at most `limit` at a time, preserving order.
 *
 * The discover page reads a dozen values from every basket, and the local
 * development node is a single-threaded process. Firing three hundred
 * simultaneous `eth_call`s at it produces timeouts and, on a hosted RPC,
 * rate-limit errors that look like application bugs. Bounding concurrency is
 * what keeps that from being a support ticket.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error('mapLimit requires a concurrency limit of at least 1.');
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Awaits `promise`, resolving to `fallback` if it rejects.
 *
 * Used for the per-basket reads on the discover page: one basket with a price
 * feed that has gone quiet should not blank the whole list. The failure is
 * carried in the value so the row can say what is wrong with it.
 */
export async function settle<T, F>(promise: Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

/** Splits a list into fixed-size chunks. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Sums bigints.
 *
 * `Array.prototype.reduce` on an empty array without an initial value throws,
 * and a basket with no components is a state the contracts allow.
 */
export function sum(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}
