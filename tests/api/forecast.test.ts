import { NextRequest } from "next/server";
import { GET } from "@/app/api/forecast/route";
import { _resetRateLimits } from "@/lib/rate-limit";
import * as forecastLib from "@/lib/forecast";
import * as queries from "@/lib/forecast-queries";

jest.mock("@/lib/forecast-queries", () => ({
  getRideForecastsForDate: jest.fn(),
  getHistoricalRideWaitsForDate: jest.fn(),
  getRecentCollectRuns: jest.fn(),
}));

jest.mock("@/lib/forecast", () => ({ getCrowdScoreForDate: jest.fn() }));

const mockGetRides = queries.getRideForecastsForDate as jest.Mock;
const mockGetHistorical = queries.getHistoricalRideWaitsForDate as jest.Mock;
const mockGetRuns = queries.getRecentCollectRuns as jest.Mock;
const mockCrowdScore = forecastLib.getCrowdScoreForDate as jest.Mock;

function makeReq(date: string, park = 16) {
  return new NextRequest(new URL(`http://localhost/api/forecast?date=${date}&park=${park}`));
}

const spaceMountain = {
  rideId: 1, rideName: "Space Mountain", landName: "Tomorrowland",
  avgWait: 45, peakWait: 70, mlConfidence: 0.85,
};
const historicalSpaceMountain = {
  rideId: 1, rideName: "Space Mountain", landName: "Tomorrowland", avgWait: 60, peakWait: 90,
};
const recentRun = { success: true, ranAt: new Date() };

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimits();
  recentRun.ranAt = new Date();
  mockGetRides.mockResolvedValue([]);
  mockGetHistorical.mockResolvedValue([]);
  mockCrowdScore.mockResolvedValue(null);
  mockGetRuns.mockResolvedValue([recentRun]);
});

describe("forecast route — compact ML path", () => {
  beforeEach(() => {
    mockGetRides.mockResolvedValue([spaceMountain]);
    mockCrowdScore.mockResolvedValue(60);
  });

  it("returns compact ride-day predictions without waiting for narration", async () => {
    const body = await (await GET(makeReq("2026-06-01"))).json();

    expect(body).toMatchObject({
      date: "2026-06-01", parkId: 16, source: "ml", crowdScore: 60,
      crowdNarration: null, forecasts: [spaceMountain], dataQualityOk: true,
    });
    expect(body.lastCollectedAt).toBe(recentRun.ranAt.toISOString());
  });

  it("scopes every prediction query to the requested park", async () => {
    await GET(makeReq("2026-06-01", 17));

    expect(mockGetRides).toHaveBeenCalledWith("2026-06-01", 17);
    expect(mockCrowdScore).toHaveBeenCalledWith("2026-06-01", 17);
    expect(mockGetRuns).toHaveBeenCalledWith(3);
    expect(mockGetHistorical).not.toHaveBeenCalled();
  });

  it("marks collection data stale after three missed collector windows", async () => {
    mockGetRuns.mockResolvedValue([{ success: true, ranAt: new Date(Date.now() - 91 * 60_000) }]);
    expect((await (await GET(makeReq("2026-06-01"))).json()).dataQualityOk).toBe(false);
  });
});

describe("forecast route — historical and unavailable paths", () => {
  it("uses a park-scoped historical fallback when no serving projection exists", async () => {
    mockGetHistorical.mockResolvedValue([historicalSpaceMountain]);

    const body = await (await GET(makeReq("2026-06-01", 17))).json();
    expect(body.source).toBe("historical");
    expect(body.forecasts).toEqual([{ ...historicalSpaceMountain, mlConfidence: 0.25 }]);
    expect(body.crowdScore).toBe(90);
    expect(mockGetHistorical).toHaveBeenCalledWith("2026-06-01", 17);
  });

  it("returns unavailable instead of calling an LLM when there is no data", async () => {
    const body = await (await GET(makeReq("2026-06-01"))).json();
    expect(body).toMatchObject({ source: "unavailable", crowdScore: null, crowdNarration: null, forecasts: [] });
  });
});

describe("forecast route — validation and caching", () => {
  it.each(["not-a-date", "2026/06/01", "2026-13-01", "2026-02-31", ""]) ("rejects invalid date %s", async (date) => {
    expect((await GET(makeReq(date))).status).toBe(400);
  });

  it("rejects an unknown park before querying", async () => {
    expect((await GET(makeReq("2026-06-01", 999))).status).toBe(400);
    expect(mockGetRides).not.toHaveBeenCalled();
  });

  it("sets a CDN cache header", async () => {
    mockGetRides.mockResolvedValue([spaceMountain]);
    const response = await GET(makeReq("2026-06-01"));
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=1800");
  });
});
