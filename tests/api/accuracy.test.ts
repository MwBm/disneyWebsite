import { GET } from "@/app/api/accuracy/route";
import { prisma } from "@/lib/db";

const mockQueryRaw = prisma.$queryRaw as jest.Mock;

beforeEach(() => jest.clearAllMocks());

/**
 * The route issues two aggregate queries in parallel: summary, then per-ride.
 * Postgres does the maths now, so these tests assert the route's handling of
 * what comes back rather than re-testing the arithmetic in JavaScript.
 */
function mockAggregates(summary: unknown[], perRide: unknown[]) {
  mockQueryRaw.mockResolvedValueOnce(summary).mockResolvedValueOnce(perRide);
}

const summaryRow = {
  mae: 7.5,
  within5: 0.42,
  within10: 0.71,
  within15: 0.88,
  totalPredictions: 1234,
};

function perRideRow(overrides: Record<string, unknown> = {}) {
  return {
    rideId: 1,
    rideName: "Space Mountain",
    landName: "Tomorrowland",
    mae: 6.2,
    within10: 0.8,
    sampleCount: 300,
    ...overrides,
  };
}

describe("accuracy route — empty state", () => {
  it("returns nulls when the window contains no matched predictions", async () => {
    mockAggregates([{ ...summaryRow, mae: null, totalPredictions: 0 }], []);

    expect(await (await GET()).json()).toEqual({ summary: null, perRide: [] });
  });

  it("returns nulls when the summary query yields no row at all", async () => {
    mockAggregates([], []);

    expect(await (await GET()).json()).toEqual({ summary: null, perRide: [] });
  });
});

describe("accuracy route — summary", () => {
  it("passes the aggregated statistics through", async () => {
    mockAggregates([summaryRow], []);

    const { summary } = await (await GET()).json();
    expect(summary).toEqual({
      mae: 7.5,
      within5: 0.42,
      within10: 0.71,
      within15: 0.88,
      totalPredictions: 1234,
    });
  });

  it("coerces the BigInt count Postgres returns for COUNT(*)", async () => {
    // JSON.stringify throws on BigInt, so an uncoerced count 500s the route.
    mockAggregates([{ ...summaryRow, totalPredictions: BigInt(1234) }], []);

    const res = await GET();
    const { summary } = await res.json();
    expect(res.status).toBe(200);
    expect(summary.totalPredictions).toBe(1234);
    expect(typeof summary.totalPredictions).toBe("number");
  });
});

describe("accuracy route — per-ride", () => {
  it("maps each aggregated ride row", async () => {
    mockAggregates([summaryRow], [perRideRow()]);

    const { perRide } = await (await GET()).json();
    expect(perRide).toEqual([
      {
        rideId: 1,
        rideName: "Space Mountain",
        landName: "Tomorrowland",
        parkName: "Disneyland",
        mae: 6.2,
        within10: 0.8,
        sampleCount: 300,
      },
    ]);
  });

  it("coerces BigInt ride ids and sample counts", async () => {
    mockAggregates(
      [summaryRow],
      [perRideRow({ rideId: BigInt(42), sampleCount: BigInt(17) })]
    );

    const { perRide } = await (await GET()).json();
    expect(perRide[0].rideId).toBe(42);
    expect(perRide[0].sampleCount).toBe(17);
  });

  it("preserves the ordering the SQL produced rather than re-sorting", async () => {
    mockAggregates(
      [summaryRow],
      [perRideRow({ rideId: 2, mae: 3 }), perRideRow({ rideId: 1, mae: 9 })]
    );

    const { perRide } = await (await GET()).json();
    expect(perRide.map((r: { rideId: number }) => r.rideId)).toEqual([2, 1]);
  });

  it.each([
    ["Cars Land", "Disney California Adventure"],
    ["Avengers Campus", "Disney California Adventure"],
    ["Pixar Pier", "Disney California Adventure"],
    ["San Fransokyo Square", "Disney California Adventure"],
    ["Tomorrowland", "Disneyland"],
    ["New Orleans Square", "Disneyland"],
    ["Brand New Land", "Disneyland"],
  ])("attributes land %s to %s", async (landName, expected) => {
    mockAggregates([summaryRow], [perRideRow({ landName })]);

    const { perRide } = await (await GET()).json();
    expect(perRide[0].parkName).toBe(expected);
  });
});

describe("accuracy route — response shape", () => {
  it("sets a CDN cache header", async () => {
    mockAggregates([summaryRow], []);

    expect((await GET()).headers.get("Cache-Control")).toContain("s-maxage=1800");
  });

  it("no longer returns a raw rows array", async () => {
    // Those ~45k rows moved to /api/accuracy/rides/[rideId], which returns the
    // 48 the chart actually draws.
    mockAggregates([summaryRow], [perRideRow()]);

    expect(await (await GET()).json()).not.toHaveProperty("rows");
  });

  it("runs both aggregate queries, not one row-level query", async () => {
    mockAggregates([summaryRow], [perRideRow()]);

    await GET();
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });
});
