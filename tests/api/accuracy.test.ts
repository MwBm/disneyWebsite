import { GET } from "@/app/api/accuracy/route";
import { prisma } from "@/lib/db";

const mockQueryRaw = prisma.$queryRaw as jest.Mock;

beforeEach(() => jest.clearAllMocks());

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    rideId: 1,
    rideName: "Space Mountain",
    landName: "Tomorrowland",
    predictedFor: new Date("2026-06-01T18:00:00Z"),
    predictedWait: 40,
    actualWait: 45,
    absError: 5,
    ...overrides,
  };
}

describe("accuracy route — empty state", () => {
  it("returns nulls rather than dividing by zero on no rows", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const body = await (await GET()).json();
    expect(body).toEqual({ summary: null, perRide: [], rows: [] });
  });
});

describe("accuracy route — summary statistics", () => {
  it("computes MAE as the mean absolute error", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      row({ absError: 4 }),
      row({ absError: 6 }),
      row({ absError: 20 }),
    ]);

    const body = await (await GET()).json();
    expect(body.summary.mae).toBeCloseTo(10);
    expect(body.summary.totalPredictions).toBe(3);
  });

  it("computes the within-N buckets as inclusive fractions", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      row({ absError: 5 }),
      row({ absError: 10 }),
      row({ absError: 15 }),
      row({ absError: 40 }),
    ]);

    const { summary } = await (await GET()).json();
    // Boundaries are inclusive: an error of exactly 5 counts as within5.
    expect(summary.within5).toBeCloseTo(0.25);
    expect(summary.within10).toBeCloseTo(0.5);
    expect(summary.within15).toBeCloseTo(0.75);
  });

  it("reports perfect accuracy when every prediction is exact", async () => {
    mockQueryRaw.mockResolvedValueOnce([row({ absError: 0 }), row({ absError: 0 })]);

    const { summary } = await (await GET()).json();
    expect(summary.mae).toBe(0);
    expect(summary.within5).toBe(1);
  });
});

describe("accuracy route — per-ride breakdown", () => {
  it("groups rows by ride and averages within each", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      row({ rideId: 1, rideName: "Space Mountain", absError: 4 }),
      row({ rideId: 1, rideName: "Space Mountain", absError: 8 }),
      row({ rideId: 2, rideName: "Haunted Mansion", absError: 20 }),
    ]);

    const { perRide } = await (await GET()).json();
    expect(perRide).toHaveLength(2);

    const space = perRide.find((r: { rideId: number }) => r.rideId === 1);
    expect(space.mae).toBeCloseTo(6);
    expect(space.sampleCount).toBe(2);
  });

  it("sorts per-ride results by ascending MAE (most accurate first)", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      row({ rideId: 1, absError: 30 }),
      row({ rideId: 2, absError: 2 }),
      row({ rideId: 3, absError: 12 }),
    ]);

    const { perRide } = await (await GET()).json();
    expect(perRide.map((r: { rideId: number }) => r.rideId)).toEqual([2, 3, 1]);
  });
});

describe("accuracy route — park attribution", () => {
  it.each([
    ["Cars Land", "Disney California Adventure"],
    ["Avengers Campus", "Disney California Adventure"],
    ["Pixar Pier", "Disney California Adventure"],
    ["San Fransokyo Square", "Disney California Adventure"],
    ["Tomorrowland", "Disneyland"],
    ["New Orleans Square", "Disneyland"],
  ])("maps land %s to %s", async (landName, expected) => {
    mockQueryRaw.mockResolvedValueOnce([row({ landName })]);

    const { perRide } = await (await GET()).json();
    expect(perRide[0].parkName).toBe(expected);
  });

  it("defaults an unrecognised land to Disneyland", async () => {
    // A newly opened land would otherwise have no park at all.
    mockQueryRaw.mockResolvedValueOnce([row({ landName: "Brand New Land" })]);

    const { perRide } = await (await GET()).json();
    expect(perRide[0].parkName).toBe("Disneyland");
  });
});

describe("accuracy route — raw driver values", () => {
  it("coerces BigInt columns that Prisma returns for integer types", async () => {
    // $queryRaw hands back BigInt for int columns; JSON.stringify throws on
    // BigInt, so an uncoerced value would 500 the whole route.
    mockQueryRaw.mockResolvedValueOnce([
      row({ rideId: BigInt(7), predictedWait: BigInt(40), actualWait: BigInt(45), absError: BigInt(5) }),
    ]);

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rows[0].rideId).toBe(7);
    expect(body.rows[0].absError).toBe(5);
    expect(typeof body.summary.mae).toBe("number");
  });

  it("serialises predictedFor as an ISO string", async () => {
    mockQueryRaw.mockResolvedValueOnce([row()]);

    const { rows } = await (await GET()).json();
    expect(rows[0].predictedFor).toBe("2026-06-01T18:00:00.000Z");
  });

  it("stringifies a driver that returns predictedFor as a string already", async () => {
    mockQueryRaw.mockResolvedValueOnce([row({ predictedFor: "2026-06-01 18:00:00" })]);

    const { rows } = await (await GET()).json();
    expect(rows[0].predictedFor).toBe("2026-06-01 18:00:00");
  });
});
