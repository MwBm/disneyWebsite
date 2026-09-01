import { NextRequest } from "next/server";
import { GET } from "@/app/api/forecast/route";
import { prisma } from "@/lib/db";
import { _resetRateLimits } from "@/lib/rate-limit";
import * as groqLib from "@/lib/groq";
import * as forecastLib from "@/lib/forecast";

/**
 * Mocked at the lib boundary, matching calendar.test.ts.
 *
 * The previous version mocked prisma.dailyForecast.findMany, which
 * getForecastForDate stopped using when it moved to $queryRaw for the
 * DISTINCT ON optimization — so the mock was never consumed and the ML-path
 * tests failed on undefined. Worse, getForecastForDate and
 * getHistoricalMeansForDate both route through the single prisma.$queryRaw
 * mock, so no test could make one return ML rows and the other return
 * historical rows. The historical-fallback branch was untestable.
 *
 * forecast.ts keeps its own prisma-level tests in tests/lib/forecast.test.ts.
 */
jest.mock("@/lib/forecast", () => ({
  getForecastForDate: jest.fn(),
  getRecentCollectRuns: jest.fn(),
  getHistoricalMeansForDate: jest.fn(),
}));

jest.mock("@/lib/groq", () => ({
  narrateForecast: jest.fn(),
  narrateForecastNoDataWithScore: jest.fn(),
}));

const mockGetForecast = forecastLib.getForecastForDate as jest.Mock;
const mockGetRuns = forecastLib.getRecentCollectRuns as jest.Mock;
const mockGetHistorical = forecastLib.getHistoricalMeansForDate as jest.Mock;
const mockNarrate = groqLib.narrateForecast as jest.Mock;
const mockNarrateNoData = groqLib.narrateForecastNoDataWithScore as jest.Mock;
const mockDateContextFindUnique = prisma.dateContext.findUnique as jest.Mock;

function makeReq(date: string) {
  return new NextRequest(new URL(`http://localhost/api/forecast?date=${date}`));
}

const mlForecast = {
  rideId: 1,
  rideName: "Space Mountain",
  landName: "Tomorrowland",
  forecastFor: new Date("2026-06-01T10:00:00Z"),
  predictedWait: 45,
  crowdScore: 60,
  mlConfidence: 0.85,
};

const historicalMean = {
  rideId: 1,
  rideName: "Space Mountain",
  landName: "Tomorrowland",
  hour: 10,
  meanWait: 60,
};

const recentRun = { success: true, ranAt: new Date("2026-05-31T12:00:00Z") };

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimits();
  // Sensible defaults; each describe overrides what it cares about.
  mockGetForecast.mockResolvedValue([]);
  mockGetRuns.mockResolvedValue([recentRun]);
  mockGetHistorical.mockResolvedValue([]);
  mockDateContextFindUnique.mockResolvedValue(null);
  mockNarrate.mockResolvedValue("Test narration");
  mockNarrateNoData.mockResolvedValue({ score: 55, narration: "No data narration" });
});

describe("forecast route — ML path", () => {
  it("averages crowd score across per-ride forecasts", async () => {
    mockGetForecast.mockResolvedValue([
      { ...mlForecast, crowdScore: 60 },
      { ...mlForecast, rideId: 2, rideName: "Haunted Mansion", crowdScore: 80 },
    ]);

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("ml");
    expect(body.crowdScore).toBe(70);
    expect(body.forecasts).toHaveLength(2);
    expect(body.dataQualityOk).toBe(true);
  });

  it("serialises forecastFor as an ISO string", async () => {
    mockGetForecast.mockResolvedValue([mlForecast]);

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.forecasts[0].forecastFor).toBe("2026-06-01T10:00:00.000Z");
  });

  it("includes the Groq narration", async () => {
    mockGetForecast.mockResolvedValue([mlForecast]);

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.crowdNarration).toBe("Test narration");
    expect(mockNarrate).toHaveBeenCalledWith(60, expect.any(Array), expect.any(Date));
  });

  it("returns the forecast with a null narration when Groq throws", async () => {
    mockGetForecast.mockResolvedValue([mlForecast]);
    mockNarrate.mockRejectedValueOnce(new Error("Groq down"));

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.crowdNarration).toBeNull();
    // The forecast itself must survive — narration is a nice-to-have.
    expect(body.forecasts).toHaveLength(1);
    expect(body.crowdScore).toBe(60);
  });

  it("sets dataQualityOk false when no recent run succeeded", async () => {
    mockGetForecast.mockResolvedValue([mlForecast]);
    mockGetRuns.mockResolvedValue([{ success: false, ranAt: new Date() }]);

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.dataQualityOk).toBe(false);
  });

  it("sets dataQualityOk false when there are no runs at all", async () => {
    mockGetForecast.mockResolvedValue([mlForecast]);
    mockGetRuns.mockResolvedValue([]);

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.dataQualityOk).toBe(false);
    expect(body.lastCollectedAt).toBeNull();
  });
});

describe("forecast route — Groq adjustment", () => {
  it("applies a stored adjustment on top of the ML score", async () => {
    mockGetForecast.mockResolvedValue([mlForecast]); // score 60
    mockDateContextFindUnique.mockResolvedValue({
      groqAdjustment: 15,
      groqReasoning: "Holiday weekend",
    });

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.crowdScore).toBe(75);
    expect(body.groqAdjustment).toBe(15);
    expect(body.groqReasoning).toBe("Holiday weekend");
  });

  it("clamps an adjustment that would push the score above 100", async () => {
    mockGetForecast.mockResolvedValue([{ ...mlForecast, crowdScore: 95 }]);
    mockDateContextFindUnique.mockResolvedValue({ groqAdjustment: 30, groqReasoning: null });

    expect((await (await GET(makeReq("2026-06-01"))).json()).crowdScore).toBe(100);
  });

  it("clamps an adjustment that would push the score below 0", async () => {
    mockGetForecast.mockResolvedValue([{ ...mlForecast, crowdScore: 5 }]);
    mockDateContextFindUnique.mockResolvedValue({ groqAdjustment: -30, groqReasoning: null });

    expect((await (await GET(makeReq("2026-06-01"))).json()).crowdScore).toBe(0);
  });

  it("omits the adjustment fields when the adjustment is zero", async () => {
    mockGetForecast.mockResolvedValue([mlForecast]);
    mockDateContextFindUnique.mockResolvedValue({ groqAdjustment: 0, groqReasoning: "No change" });

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.crowdScore).toBe(60);
    expect(body.groqAdjustment).toBeUndefined();
  });
});

describe("forecast route — historical fallback", () => {
  // This branch was unreachable under the old mocking: both queries shared one
  // $queryRaw mock, so seeding historical rows also satisfied the ML query.
  beforeEach(() => {
    mockGetForecast.mockResolvedValue([]);
  });

  it("falls back to historical means when there is no ML output", async () => {
    mockGetHistorical.mockResolvedValue([
      { ...historicalMean, hour: 10, meanWait: 40 },
      { ...historicalMean, hour: 11, meanWait: 50 },
    ]);

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.source).toBe("historical");
    expect(body.forecasts).toHaveLength(2);
    expect(body.forecasts[0].mlConfidence).toBe(0.25); // HISTORICAL_FALLBACK_CONFIDENCE
  });

  it("derives the crowd score from the mean wait", async () => {
    // avgWait 60 over MAX_WAIT 120 → 50
    mockGetHistorical.mockResolvedValue([historicalMean]);

    expect((await (await GET(makeReq("2026-06-01"))).json()).crowdScore).toBe(50);
  });

  it("stamps every synthetic forecast with the same derived score", async () => {
    mockGetHistorical.mockResolvedValue([
      { ...historicalMean, hour: 10, meanWait: 30 },
      { ...historicalMean, hour: 11, meanWait: 90 },
    ]);

    const body = await (await GET(makeReq("2026-06-01"))).json();
    const scores = body.forecasts.map((f: { crowdScore: number }) => f.crowdScore);
    expect(new Set(scores).size).toBe(1);
  });

  it("narrates the historical forecast", async () => {
    mockGetHistorical.mockResolvedValue([historicalMean]);

    await GET(makeReq("2026-06-01"));
    expect(mockNarrate).toHaveBeenCalled();
  });

  it("still returns the forecast when narration throws", async () => {
    mockGetHistorical.mockResolvedValue([historicalMean]);
    mockNarrate.mockRejectedValueOnce(new Error("Groq down"));

    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.crowdNarration).toBeNull();
    expect(body.source).toBe("historical");
  });
});

describe("forecast route — Groq fallback", () => {
  beforeEach(() => {
    mockGetForecast.mockResolvedValue([]);
    mockGetHistorical.mockResolvedValue([]);
  });

  it("falls through to a Groq estimate with neither ML nor historical data", async () => {
    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body.source).toBe("groq");
    expect(body.forecasts).toEqual([]);
    expect(body.crowdScore).toBe(55);
    expect(body.crowdNarration).toBe("No data narration");
  });

  it("returns a null score and narration when Groq itself fails", async () => {
    mockNarrateNoData.mockRejectedValueOnce(new Error("down"));

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();
    // A Groq outage must degrade, not 500: the page still renders "no data".
    expect(res.status).toBe(200);
    expect(body.source).toBe("groq");
    expect(body.crowdScore).toBeNull();
    expect(body.crowdNarration).toBeNull();
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
    expect(mockGetForecast).not.toHaveBeenCalled();
  });
});

describe("forecast route — caching and rate limiting", () => {
  it("sets a CDN cache header on a successful response", async () => {
    mockGetForecast.mockResolvedValue([mlForecast]);

    const res = await GET(makeReq("2026-06-01"));
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=1800");
  });

  it("returns 429 with Retry-After once the per-IP limit is exceeded", async () => {
    mockGetForecast.mockResolvedValue([mlForecast]);

    let last = await GET(makeReq("2026-06-01"));
    for (let i = 0; i < 40 && last.status !== 429; i++) {
      last = await GET(makeReq("2026-06-01"));
    }
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
