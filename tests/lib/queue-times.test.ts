import { QueueTimesError, fetchLiveRides, roundToWindow } from "@/lib/queue-times";
import rideConfig from "@/lib/ride-config.json";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function ride(id: number, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    is_open: true,
    wait_time: 30,
    last_updated: "2026-06-01T18:00:00Z",
    ...overrides,
  };
}

/** Respond with `bodies[i]` for the i-th park fetched, in config order. */
function mockParks(bodies: unknown[], ok = true, status = 200) {
  let call = 0;
  global.fetch = jest.fn().mockImplementation(() =>
    Promise.resolve({ ok, status, json: async () => bodies[Math.min(call++, bodies.length - 1)] })
  ) as unknown as typeof fetch;
}

const emptyPark = { lands: [], rides: [] };

describe("fetchLiveRides — happy path", () => {
  it("fetches every configured park", async () => {
    mockParks([emptyPark]);
    await fetchLiveRides();
    expect(global.fetch).toHaveBeenCalledTimes(rideConfig.parks.length);
  });

  it("attaches the land name to rides nested under a land", async () => {
    mockParks([
      { lands: [{ id: 1, name: "Tomorrowland", rides: [ride(9001, "Space Mountain")] }], rides: [] },
      emptyPark,
    ]);

    const rides = await fetchLiveRides();
    const found = rides.find((r) => r.id === 9001)!;
    expect(found.landName).toBe("Tomorrowland");
    expect(found.name).toBe("Space Mountain");
    expect(found.waitTime).toBe(30);
    expect(found.isOpen).toBe(true);
  });

  it('files top-level rides outside any land under "Other"', async () => {
    mockParks([{ lands: [], rides: [ride(9002, "Orphan Ride")] }, emptyPark]);

    expect((await fetchLiveRides()).find((r) => r.id === 9002)!.landName).toBe("Other");
  });

  it("parses last_updated into a Date", async () => {
    mockParks([
      { lands: [{ id: 1, name: "L", rides: [ride(9003, "R")] }], rides: [] },
      emptyPark,
    ]);

    const found = (await fetchLiveRides()).find((r) => r.id === 9003)!;
    expect(found.lastUpdated).toBeInstanceOf(Date);
    expect(found.lastUpdated.toISOString()).toBe("2026-06-01T18:00:00.000Z");
  });

  it("keeps closed rides rather than filtering them out", async () => {
    // Closed rides carry signal — pct_rides_open depends on seeing them.
    mockParks([
      { lands: [{ id: 1, name: "L", rides: [ride(9004, "Closed", { is_open: false, wait_time: 0 })] }], rides: [] },
      emptyPark,
    ]);

    expect((await fetchLiveRides()).find((r) => r.id === 9004)!.isOpen).toBe(false);
  });

  it("flattens results across all parks", async () => {
    mockParks([
      { lands: [{ id: 1, name: "A", rides: [ride(9005, "One")] }], rides: [] },
      { lands: [{ id: 2, name: "B", rides: [ride(9006, "Two")] }], rides: [] },
    ]);

    const ids = (await fetchLiveRides()).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([9005, 9006]));
  });
});

describe("fetchLiveRides — ride exclusions", () => {
  it("drops excluded rides nested under a land", async () => {
    const excludedId = rideConfig.parks[0].excludedRideIds[0];
    mockParks([
      {
        lands: [{ id: 1, name: "L", rides: [ride(excludedId, "Excluded"), ride(9007, "Kept")] }],
        rides: [],
      },
      emptyPark,
    ]);

    const ids = (await fetchLiveRides()).map((r) => r.id);
    expect(ids).not.toContain(excludedId);
    expect(ids).toContain(9007);
  });

  it("drops excluded top-level rides too", async () => {
    const excludedId = rideConfig.parks[0].excludedRideIds[1];
    mockParks([{ lands: [], rides: [ride(excludedId, "Excluded")] }, emptyPark]);

    expect((await fetchLiveRides()).map((r) => r.id)).not.toContain(excludedId);
  });
});

describe("fetchLiveRides — failure modes", () => {
  // The module comment promises both parsers "fail loudly" on a shape change.
  // These are the tests that hold it to that.

  it("throws QueueTimesError on a non-ok HTTP response", async () => {
    mockParks([emptyPark], false, 503);
    await expect(fetchLiveRides()).rejects.toThrow(QueueTimesError);
  });

  it("names the failing park and status in the error", async () => {
    mockParks([emptyPark], false, 503);
    await expect(fetchLiveRides()).rejects.toThrow(/503/);
  });

  it("throws when a required ride field is missing", async () => {
    mockParks([
      { lands: [{ id: 1, name: "L", rides: [{ id: 1, name: "No wait_time", is_open: true }] }], rides: [] },
      emptyPark,
    ]);
    await expect(fetchLiveRides()).rejects.toThrow(QueueTimesError);
  });

  it("throws when a field arrives with the wrong type", async () => {
    mockParks([
      {
        lands: [{ id: 1, name: "L", rides: [ride(1, "R", { wait_time: "30" })] }],
        rides: [],
      },
      emptyPark,
    ]);
    await expect(fetchLiveRides()).rejects.toThrow(QueueTimesError);
  });

  it("throws when the response is not an object at all", async () => {
    mockParks(["not json"]);
    await expect(fetchLiveRides()).rejects.toThrow(QueueTimesError);
  });

  it("throws when lands is missing entirely", async () => {
    mockParks([{ rides: [] }]);
    await expect(fetchLiveRides()).rejects.toThrow(QueueTimesError);
  });

  it("propagates a network-level failure", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    await expect(fetchLiveRides()).rejects.toThrow("ECONNREFUSED");
  });

  it("fails the whole call when any single park fails", async () => {
    // Promise.all semantics: a partial result would silently understate
    // pct_rides_open for every ride in the surviving park.
    let call = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      call += 1;
      return call === 1
        ? Promise.resolve({ ok: true, status: 200, json: async () => emptyPark })
        : Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    }) as unknown as typeof fetch;

    await expect(fetchLiveRides()).rejects.toThrow(QueueTimesError);
  });
});

describe("roundToWindow", () => {
  it("rounds down within the first half of a 30-minute window", () => {
    expect(roundToWindow(new Date("2026-06-01T10:07:00Z")).toISOString())
      .toBe("2026-06-01T10:00:00.000Z");
  });

  it("rounds up within the second half", () => {
    expect(roundToWindow(new Date("2026-06-01T10:23:00Z")).toISOString())
      .toBe("2026-06-01T10:30:00.000Z");
  });

  it("rounds up at the exact midpoint", () => {
    expect(roundToWindow(new Date("2026-06-01T10:15:00Z")).toISOString())
      .toBe("2026-06-01T10:30:00.000Z");
  });

  it("leaves an already-aligned time untouched", () => {
    expect(roundToWindow(new Date("2026-06-01T10:30:00Z")).toISOString())
      .toBe("2026-06-01T10:30:00.000Z");
  });

  it("rolls across an hour boundary", () => {
    expect(roundToWindow(new Date("2026-06-01T10:52:00Z")).toISOString())
      .toBe("2026-06-01T11:00:00.000Z");
  });

  it("rolls across a day boundary", () => {
    expect(roundToWindow(new Date("2026-06-01T23:50:00Z")).toISOString())
      .toBe("2026-06-02T00:00:00.000Z");
  });

  it("discards sub-minute precision", () => {
    expect(roundToWindow(new Date("2026-06-01T10:07:33.456Z")).toISOString())
      .toBe("2026-06-01T10:00:00.000Z");
  });

  it("always lands on :00 or :30 with zero seconds", () => {
    for (let m = 0; m < 60; m++) {
      const out = roundToWindow(new Date(Date.UTC(2026, 5, 1, 10, m)));
      expect([0, 30]).toContain(out.getUTCMinutes());
      expect(out.getUTCSeconds()).toBe(0);
    }
  });
});
