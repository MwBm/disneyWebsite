/**
 * Run an async function over a list with a hard concurrency ceiling.
 *
 * Results come back as settled outcomes in input order, so one failure does not
 * abandon the rest and a caller can count successes and log failures.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return [];

  // A limit below 1 would deadlock the worker loop; a limit above the input
  // just means one worker per item.
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;

  async function work(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, work));
  return results;
}
