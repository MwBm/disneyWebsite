import { NextRequest } from "next/server";
import { GET } from "@/app/api/forecast/route";
import { prisma } from "@/lib/db";
import { _resetRateLimits } from "@/lib/rate-limit";
import * as groqLib from "@/lib/groq";
import * as forecastLib from "@/lib/forecast";
import * as queries from "@/lib/forecast-queries";

/**
 * Mocked at the lib boundary. The SQL behind these functions is covered
 * against a real Postgres in tests/integration/forecast-queries.test.ts; here
 * only the route's branching and response shape are under test.
 */
jest.mock("@/lib/forecast-queries", () => ({
  getRideForecastsForDate: jest.fn(),
  getHistoricalRideWaitsForDate: jest.fn(),
  getRecentCollectRuns: jest.fn(),
}));

jest.mock("@/lib/forecast", () => ({
  getCrowdScoreForDate: jest.fn(),
}));

jest.mock("@/lib/groq", () => ({
  narrateForecast: jest.fn(),
  narrateForecastNoDataWithScore: jest.fn(),
}));

const mockGetRides = queries.getRideForecastsForDate as jest.Mock;
const mockGetHistorical = queries.getHistoricalRideWaitsForDate as jest.Mock;
const mockGetRuns = queries.getRecentCollectRuns as jest.Mock;
const mockCrowdScore = forecastLib.getCrowdScoreForDate as jest.Mock;
const mockNarrate = groqLib.narrateForecast as jest.Mock;
const mockNarrateNoData = groqLib.narrateForecastNoDataWithScore as jest.Mock;
const mockDateContextFindUnique = prisma.dateContext.findUnique as jest.Mock;

function makeReq(date: string) {
  return new NextRequest(new URL(`http://localhost/api/forecast?date=${date}`));
}

const spaceMountain = {
  rideId: 1,
  rideName: "Space Mountain",
  landName: "Tomorrowland",
  avgWait: 45,
  peakWait: 70,
  mlConfidence: 0.85,
};
const hauntedMansion = { ...spaceMountain, rideId: 2, rideName: "Haunted Mansion", avgWait: 25, peakWait: 40 };

const historicalSpaceMountain = {
  rideId: 1,
  rideName: "Space Mountain",
  landName: "Tomorrowland",
  avgWait: 60,
  peakWait: 90,
};

const recentRun = { success: true, ranAt: new Date("2026-05-31T12:00:00Z") };

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimits();
  // Sensible defaults; each describe overrides what it cares about.
  mockGetRides.mockResolvedValue([]);
  mockCrowdScore.mockResolvedValue(null);
  mockGetRuns.mockResolvedValue([recentRun]);
  mockGetHistorical.mockResolvedValue([]);
  mockDateContextFindUnique.mockResolvedValue(null);
  mockNarrate.mockResolvedValue("Test narration");
  mockNarrateNoData.mockResolvedValue({ score: 55, narration: "No data narration" });
});

describe("forecast route — ML path", () => {
  beforeEach(() => {
    mockGetRides.mockResolvedValue([spaceMountain, hauntedMansion]);
    mockCrowdScore.mockResolvedValue(60);
  });

  it("returns one avg/peak entry per ride and the day's crowd score", async () => {
    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("ml");
    expect(body.crowdScore).toBe(60);
    expect(body.forecasts).toEqual([spaceMountain, hauntedMansion]);
    expect(body.dataQualityOk).toBe(true);
    expect(body.lastCollectedAt).toBe("2026-05-31T12:00:00.000Z");
  });

  it("no longer exposes a per-slot time or per-row crowd score", async () => {
    const body = await (await GET(makeReq("2026-06-01"))).json();
    for (const ride of body.forecasts) {
      expect(ride).not.toHaveProperty("forecastFor");
      expect(ride).not.toHaveProperty("predictedWait");
      expect(ride).not.toHaveProperty("crowdScore");
    }
  });

  it("queries every source for the requested park date", async () => {
    await GET(makeReq("2026-06-01"));

    expect(mockGetRides).toHaveBeenCalledWith("2026-06-01");
    expect(mockCrowdScore).toHaveBeenCalledWith("2026-06-01");
    expect(mockGetRuns).toHaveBeenCalledWith(3);
    // Pacific midnight of Jun 1 is 07:00 UTC.
    expect(mockDateContextFindUnique.mock.calls[0][0].where.date).toEqual(new Date("2026-06-01T07:00:00Z"));
    expect(mockGetHistorical).not.toHaveBeenCalled();
  });

  it("narrates with the crowd score and the per-ride forecasts", async () => {
    const body = await (await GET(makeReq("2026-06-01"))).json();

    expect(body.crowdNarration).toBe("Test narration");
    expect(mockNarrate).toHaveBeenCalledWith(60, [spaceMountain, hauntedMansion], expect.any(Date));
  });

  it("returns the forecast with a null narration when Groq throws", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockNarrate.mockRejectedValueOnce(new Error("Groq down"));

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.crowdNarration).toBeNull();
    // The forecast itself must survive — narration is a nice-to-have — and the failure is logged.
    expect(body.forecasts).toHaveLength(2);
    expect(body.crowdScore).toBe(60);
    expect(consoleError).toHaveBeenCalledWith("narrateForecast failed (ml path)", expect.any(Error));
    consoleError.mockRestore();
  });

  it("returns rides with a null score and no narration if no daily score exists", async () => {
    mockCrowdScore.mockResolvedValue(null);

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.source).toBe("ml");
    expect(body.crowdScore).toBeNull();
    expect(body.crowdNarration).toBeNull();
    expect(mockNarrate).not.toHaveBeenCalled();
  });

  it("sets dataQualityOk false when no recent run succeeded", async () => {
    mockGetRuns.mockResolvedValue([{ success: false, ranAt: new Date() }]);

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.dataQualityOk).toBe(false);
  });

  it("sets dataQualityOk false when there are no runs at all", async () => {
    mockGetRuns.mockResolvedValue([]);

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.dataQualityOk).toBe(false);
    expect(body.lastCollectedAt).toBeNull();
  });
});

describe("forecast route — Groq adjustment", () => {
  beforeEach(() => {
    mockGetRides.mockResolvedValue([spaceMountain]);
    mockCrowdScore.mockResolvedValue(60);
  });

  it("applies a stored adjustment on top of the ML score", async () => {
    mockDateContextFindUnique.mockResolvedValue({ groqAdjustment: 15, groqReasoning: "Holiday weekend" });

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.crowdScore).toBe(75);
    expect(body.groqAdjustment).toBe(15);
    expect(body.groqReasoning).toBe("Holiday weekend");
  });

  it("rounds a fractional adjustment", async () => {
    mockDateContextFindUnique.mockResolvedValue({ groqAdjustment: 2.6, groqReasoning: null });

    expect((await (await GET(makeReq("2026-06-01"))).json()).crowdScore).toBe(63);
  });

  it("clamps an adjustment that would push the score above 100", async () => {
    mockCrowdScore.mockResolvedValue(95);
    mockDateContextFindUnique.mockResolvedValue({ groqAdjustment: 30, groqReasoning: null });

    expect((await (await GET(makeReq("2026-06-01"))).json()).crowdScore).toBe(100);
  });

  it("clamps an adjustment that would push the score below 0", async () => {
    mockCrowdScore.mockResolvedValue(5);
    mockDateContextFindUnique.mockResolvedValue({ groqAdjustment: -30, groqReasoning: null });

    expect((await (await GET(makeReq("2026-06-01"))).json()).crowdScore).toBe(0);
  });

  it("omits the adjustment fields when the adjustment is zero", async () => {
    mockDateContextFindUnique.mockResolvedValue({ groqAdjustment: 0, groqReasoning: "No change" });

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.crowdScore).toBe(60);
    expect(body.groqAdjustment).toBeUndefined();
  });

  it("narrates with the adjusted score", async () => {
    mockDateContextFindUnique.mockResolvedValue({ groqAdjustment: 10, groqReasoning: null });

    await GET(makeReq("2026-06-01"));
    expect(mockNarrate).toHaveBeenCalledWith(70, expect.any(Array), expect.any(Date));
  });
});

describe("forecast route — historical fallback", () => {
  it("returns one entry per ride, not one per ride per hour", async () => {
    mockGetHistorical.mockResolvedValue([
      historicalSpaceMountain,
      { ...historicalSpaceMountain, rideId: 2, rideName: "Matterhorn", avgWait: 40, peakWait: 55 },
    ]);

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.source).toBe("historical");
    expect(body.forecasts).toEqual([
      { ...historicalSpaceMountain, mlConfidence: 0.25 }, // HISTORICAL_FALLBACK_CONFIDENCE
      { ...historicalSpaceMountain, rideId: 2, rideName: "Matterhorn", avgWait: 40, peakWait: 55, mlConfidence: 0.25 },
    ]);
    expect(mockGetHistorical).toHaveBeenCalledWith("2026-06-01");
  });

  it("derives the crowd score from the mean of the rides' average waits", async () => {
    // mean(40, 80) = 60 over MAX_WAIT 120 → 50; peaks must not matter.
    mockGetHistorical.mockResolvedValue([
      { ...historicalSpaceMountain, avgWait: 40, peakWait: 120 },
      { ...historicalSpaceMountain, rideId: 2, avgWait: 80, peakWait: 120 },
    ]);

    expect((await (await GET(makeReq("2026-06-01"))).json()).crowdScore).toBe(50);
  });

  it("ignores any stored Groq adjustment", async () => {
    mockGetHistorical.mockResolvedValue([historicalSpaceMountain]);
    mockDateContextFindUnique.mockResolvedValue({ groqAdjustment: 20, groqReasoning: "x" });

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.crowdScore).toBe(50);
    expect(body.groqAdjustment).toBeUndefined();
  });

  it("narrates the historical forecast", async () => {
    mockGetHistorical.mockResolvedValue([historicalSpaceMountain]);

    await GET(makeReq("2026-06-01"));
    expect(mockNarrate).toHaveBeenCalledWith(50, [{ ...historicalSpaceMountain, mlConfidence: 0.25 }], expect.any(Date));
  });

  it("still returns the forecast when narration throws", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetHistorical.mockResolvedValue([historicalSpaceMountain]);
    mockNarrate.mockRejectedValueOnce(new Error("Groq down"));

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.crowdNarration).toBeNull();
    expect(body.source).toBe("historical");
    expect(consoleError).toHaveBeenCalledWith("narrateForecast failed (historical path)", expect.any(Error));
    consoleError.mockRestore();
  });
});

describe("forecast route — Groq fallback", () => {
  it("falls through to a Groq estimate with neither ML nor historical data", async () => {
    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.source).toBe("groq");
    expect(body.forecasts).toEqual([]);
    expect(body.crowdScore).toBe(55);
    expect(body.crowdNarration).toBe("No data narration");
    expect(mockNarrate).not.toHaveBeenCalled();
  });

  it("returns a null score and narration when Groq itself fails", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockNarrateNoData.mockRejectedValueOnce(new Error("down"));

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();
    // A Groq outage must degrade, not 500: the page still renders "no data".
    expect(res.status).toBe(200);
    expect(body.source).toBe("groq");
    expect(body.crowdScore).toBeNull();
    expect(body.crowdNarration).toBeNull();
    consoleError.mockRestore();
  });
});

describe("forecast route — validation", () => {
  it("returns 400 when the date param is missing", async () => {
    const res = await GET(new NextRequest(new URL("http://localhost/api/forecast")));
    expect(res.status).toBe(400);
  });

  it.each([
    ["a non-date string", "not-a-date"],
    ["the wrong separator", "2026/06/01"],
    ["a single-digit month", "2026-6-01"],
    ["an impossible month", "2026-13-01"],
    ["an impossible day", "2026-02-31"],
    ["an empty value", ""],
  ])("returns 400 for %s", async (_label, value) => {
    expect((await GET(makeReq(value))).status).toBe(400);
  });

  it("does not touch the database when validation fails", async () => {
    await GET(makeReq("not-a-date"));
    expect(mockGetRides).not.toHaveBeenCalled();
  });
});

describe("forecast route — caching and rate limiting", () => {
  it("sets a CDN cache header on a successful response", async () => {
    mockGetRides.mockResolvedValue([spaceMountain]);
    mockCrowdScore.mockResolvedValue(60);

    const res = await GET(makeReq("2026-06-01"));
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=1800");
  });

  it("returns 429 with Retry-After once the per-IP limit is exceeded, before any query", async () => {
    mockGetRides.mockResolvedValue([spaceMountain]);

    let last = await GET(makeReq("2026-06-01"));
    for (let i = 0; i < 40 && last.status !== 429; i++) {
      last = await GET(makeReq("2026-06-01"));
    }
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("Retry-After"))).toBeGreaterThan(0);

    const callsBefore = mockGetRides.mock.calls.length;
    expect((await GET(makeReq("2026-06-01"))).status).toBe(429);
    expect(mockGetRides.mock.calls.length).toBe(callsBefore);
  });
});
