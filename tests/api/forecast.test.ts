import { NextRequest } from "next/server";
import { GET } from "@/app/api/forecast/route";
import { prisma } from "@/lib/db";
import * as groqLib from "@/lib/groq";

const mockForecastFindMany = prisma.dailyForecast.findMany as jest.Mock;
const mockCollectRunFindMany = prisma.collectRun.findMany as jest.Mock;
const mockQueryRaw = prisma.$queryRaw as jest.Mock;

jest.mock("@/lib/groq", () => ({
  narrateForecast: jest.fn().mockResolvedValue("Test narration"),
  narrateForecastNoData: jest.fn().mockResolvedValue("No data narration"),
}));

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

const recentRun = { success: true, ranAt: new Date() };

describe("forecast route — ML path", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns ML forecasts with crowd score averaged from forecasts", async () => {
    mockForecastFindMany.mockResolvedValue([
      { ...mlForecast, crowdScore: 60 },
      { ...mlForecast, rideId: 2, rideName: "Haunted Mansion", crowdScore: 80 },
    ]);
    mockCollectRunFindMany.mockResolvedValue([recentRun]);

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("ml");
    expect(body.crowdScore).toBe(70); // avg of 60 and 80
    expect(body.forecasts).toHaveLength(2);
    expect(body.dataQualityOk).toBe(true);
  });

  it("includes crowdNarration from Groq", async () => {
    mockForecastFindMany.mockResolvedValue([mlForecast]);
    mockCollectRunFindMany.mockResolvedValue([recentRun]);

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();

    expect(body.crowdNarration).toBe("Test narration");
    expect(groqLib.narrateForecast).toHaveBeenCalledWith(
      60,
      expect.any(Array),
      expect.any(Date)
    );
  });

  it("returns crowdNarration as null when Groq throws", async () => {
    mockForecastFindMany.mockResolvedValue([mlForecast]);
    mockCollectRunFindMany.mockResolvedValue([recentRun]);
    (groqLib.narrateForecast as jest.Mock).mockRejectedValueOnce(new Error("Groq down"));

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();

    expect(body.crowdNarration).toBeNull();
  });

  it("sets dataQualityOk false when no successful recent runs", async () => {
    mockForecastFindMany.mockResolvedValue([mlForecast]);
    mockCollectRunFindMany.mockResolvedValue([{ success: false, ranAt: new Date() }]);

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();

    expect(body.dataQualityOk).toBe(false);
  });
});

describe("forecast route — historical path", () => {
  beforeEach(() => jest.clearAllMocks());

  it("falls back to historical when no ML forecasts", async () => {
    mockForecastFindMany.mockResolvedValue([]);
    mockCollectRunFindMany.mockResolvedValue([recentRun]);
    mockQueryRaw.mockResolvedValue([
      { rideId: 1, rideName: "Space Mountain", landName: "Tomorrowland", hour: 10, meanWait: 40 },
      { rideId: 1, rideName: "Space Mountain", landName: "Tomorrowland", hour: 11, meanWait: 50 },
    ]);

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("historical");
    expect(body.forecasts.length).toBeGreaterThan(0);
    expect(body.forecasts[0].mlConfidence).toBe(0.25); // HISTORICAL_FALLBACK_CONFIDENCE
  });

  it("crowd score derived from avgWait of historical means", async () => {
    mockForecastFindMany.mockResolvedValue([]);
    mockCollectRunFindMany.mockResolvedValue([recentRun]);
    // avgWait = 60 → deriveCrowdScore(60) = (60/120)*100 = 50
    mockQueryRaw.mockResolvedValue([
      { rideId: 1, rideName: "Space Mountain", landName: "Tomorrowland", hour: 10, meanWait: 60 },
    ]);

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();

    expect(body.crowdScore).toBe(50);
  });

  it("calls narrateForecast with historical crowd score", async () => {
    mockForecastFindMany.mockResolvedValue([]);
    mockCollectRunFindMany.mockResolvedValue([recentRun]);
    mockQueryRaw.mockResolvedValue([
      { rideId: 1, rideName: "Space Mountain", landName: "Tomorrowland", hour: 10, meanWait: 60 },
    ]);

    await GET(makeReq("2026-06-01"));

    expect(groqLib.narrateForecast).toHaveBeenCalled();
  });
});

describe("forecast route — Groq fallback path", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns source=groq when no forecasts and no historical data", async () => {
    mockForecastFindMany.mockResolvedValue([]);
    mockCollectRunFindMany.mockResolvedValue([recentRun]);
    mockQueryRaw.mockResolvedValue([]);

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("groq");
    expect(body.forecasts).toEqual([]);
    expect(body.crowdScore).toBeNull();
    expect(body.crowdNarration).toBe("No data narration");
  });

  it("returns null crowdNarration when Groq throws on no-data path", async () => {
    mockForecastFindMany.mockResolvedValue([]);
    mockCollectRunFindMany.mockResolvedValue([recentRun]);
    mockQueryRaw.mockResolvedValue([]);
    (groqLib.narrateForecastNoData as jest.Mock).mockRejectedValueOnce(new Error("down"));

    const res = await GET(makeReq("2026-06-01"));
    const body = await res.json();

    expect(body.crowdNarration).toBeNull();
  });
});

describe("forecast route — validation", () => {
  it("returns 400 for missing date param", async () => {
    const req = new NextRequest(new URL("http://localhost/api/forecast"));
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid date", async () => {
    const res = await GET(makeReq("not-a-date"));
    expect(res.status).toBe(400);
  });
});
