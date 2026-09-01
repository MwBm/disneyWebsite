/**
 * Run an async function over a list with a hard concurrency ceiling.
 *
 * `Promise.all(items.map(fn))` starts every task at once. On the date-context
 * cron that meant up to 365 simultaneous Groq requests and 365 simultaneous
 * writes through a pgbouncer pool. It also fails all-or-nothing: one rejected
 * write abandons the rest of the batch, and the caller sees a single error
 * instead of 364 successes and 1 failure.
 *
 * Results come back as settled outcomes in input order, so a caller can count
 * successes, log failures, and still make progress.
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
