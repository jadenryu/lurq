/**
 * Resolve with `task`'s value, or `null` once `ms` elapses.
 *
 * The `clearTimeout` is the whole reason this is shared rather than written
 * inline at each call site. A pending `setTimeout` holds Node's event loop open,
 * so a version of this that skips the cleanup leaves a short-lived process — the
 * CLI — sitting idle for the remainder of the budget after the answer is already
 * printed. Two copies of this existed and only one cleared its timer; the other
 * cost `lurq usage` up to four seconds of dead wait per lookup.
 *
 * The task is deliberately NOT cancelled when the budget expires: callers use
 * this for read-through caches where the abandoned work is what warms the cache
 * for the next request.
 */
export function withBudget<T>(task: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    task,
    new Promise<null>((resolve) => {
      timer = setTimeout(resolve, ms, null);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Map over items with bounded concurrency, preserving input order. */
export async function pMap<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
