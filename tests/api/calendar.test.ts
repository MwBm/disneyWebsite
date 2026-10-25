import { NextRequest } from "next/server";
import { GET } from "@/app/api/calendar/route";
import { _resetRateLimits } from "@/lib/rate-limit";
import * as forecastLib from "@/lib/forecast";

jest.mock("@/lib/forecast", () => ({ getCrowdScoresForMonth: jest.fn() }));

function makeReq(year: number, month: number, park = 16) {
  return new NextRequest(new URL(`http://localhost/api/calendar?year=${year}&month=${month}&park=${park}`));
}

const days = Array.from({ length: 31 }, (_, i) => ({
  date: `2026-05-${String(i + 1).padStart(2, "0")}`,
  crowdScore: 50 + (i % 10),
  source: "ml" as const,
  tier: null,
  specialEvent: null,
  isHoliday: false,
}));

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimits();
  (forecastLib.getCrowdScoresForMonth as jest.Mock).mockResolvedValue(days);
});

describe("calendar route", () => {
  it("returns materialized scores without a blocking LLM fallback", async () => {
    const response = await GET(makeReq(2026, 5));
    expect(await response.json()).toEqual({ year: 2026, month: 5, parkId: 16, days });
    expect(forecastLib.getCrowdScoresForMonth).toHaveBeenCalledWith(2026, 5, 16);
  });

  it("passes the requested park through", async () => {
    await GET(makeReq(2026, 5, 17));
    expect(forecastLib.getCrowdScoresForMonth).toHaveBeenCalledWith(2026, 5, 17);
  });

  it.each([
    ["missing params", "http://localhost/api/calendar"],
    ["bad month", "http://localhost/api/calendar?year=2026&month=13"],
    ["bad park", "http://localhost/api/calendar?year=2026&month=5&park=999"],
  ])("returns 400 for %s", async (_label, url) => {
    expect((await GET(new NextRequest(new URL(url)))).status).toBe(400);
  });

  it("sets a CDN cache header", async () => {
    const response = await GET(makeReq(2026, 5));
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=3600");
  });
});
