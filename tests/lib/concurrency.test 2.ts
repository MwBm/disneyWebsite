import { mapWithConcurrency } from "@/lib/concurrency";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("mapWithConcurrency — results", () => {
  it("returns results in input order, not completion order", async () => {
    const out = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });

    expect(out.map((r) => (r as PromiseFulfilledResult<number>).value)).toEqual([30, 10, 20]);
  });

  it("passes the index to the mapper", async () => {
    const out = await mapWithConcurrency(["a", "b"], 1, async (item, i) => `${i}:${item}`);
    expect(out.map((r) => (r as PromiseFulfilledResult<string>).value)).toEqual(["0:a", "1:b"]);
  });

  it("returns an empty array for empty input without invoking the mapper", async () => {
    const fn = jest.fn();
    expect(await mapWithConcurrency([], 5, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("visits every item exactly once", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];

    await mapWithConcurrency(items, 7, async (n) => {
      await tick();
      seen.push(n);
    });

    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });
});

describe("mapWithConcurrency — the ceiling", () => {
  it("never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 40 }), 5, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    });

    expect(peak).toBeLessThanOrEqual(5);
  });

  it("actually runs in parallel up to the limit", async () => {
    let peak = 0;
    let active = 0;

    await mapWithConcurrency(Array.from({ length: 20 }), 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });

    expect(peak).toBe(4);
  });

  it("serialises when the limit is 1", async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency([1, 2, 3, 4], 1, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    });

    expect(peak).toBe(1);
  });

  it.each([0, -5, NaN])("treats a limit of %s as 1 rather than deadlocking", async (limit) => {
    const out = await mapWithConcurrency([1, 2], limit, async (n) => n * 2);
    expect(out.map((r) => (r as PromiseFulfilledResult<number>).value)).toEqual([2, 4]);
  });

  it("caps workers at the item count when the limit exceeds it", async () => {
    const out = await mapWithConcurrency([1], 100, async (n) => n);
    expect(out).toHaveLength(1);
  });
});

describe("mapWithConcurrency — failure isolation", () => {
  it("keeps going after a rejection instead of aborting the batch", async () => {
    // Promise.all would have discarded every other result here.
    const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });

    expect(out[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(out[1].status).toBe("rejected");
    expect(out[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  it("preserves the rejection reason", async () => {
    const out = await mapWithConcurrency([1], 1, async () => {
      throw new Error("specific failure");
    });

    expect((out[0] as PromiseRejectedResult).reason).toEqual(new Error("specific failure"));
  });

  it("does not reject even when every item fails", async () => {
    const out = await mapWithConcurrency([1, 2, 3], 3, async () => {
      throw new Error("all bad");
    });

    expect(out.every((r) => r.status === "rejected")).toBe(true);
  });

  it("runs the remaining items after an early failure", async () => {
    const completed: number[] = [];

    await mapWithConcurrency([1, 2, 3, 4, 5], 1, async (n) => {
      if (n === 1) throw new Error("first fails");
      completed.push(n);
    });

    expect(completed).toEqual([2, 3, 4, 5]);
  });
});
