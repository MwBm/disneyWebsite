import { NextRequest } from "next/server";
import { GET } from "@/app/api/forecast/rides/[rideId]/route";
import { _resetRateLimits } from "@/lib/rate-limit";
import * as queries from "@/lib/forecast-queries";

jest.mock("@/lib/forecast-queries", () => ({
  getRideForecastHoursForDate: jest.fn(),
  getHistoricalRideForecastHoursForDate: jest.fn(),
}));

const mockMlHours = queries.getRideForecastHoursForDate as jest.Mock;
const mockHistoricalHours = queries.getHistoricalRideForecastHoursForDate as jest.Mock;

function request(date: string) {
  return new NextRequest(`http://localhost/api/forecast/rides/7?date=${date}`);
}

function context(rideId = "7") {
  return { params: Promise.resolve({ rideId }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimits();
  mockMlHours.mockResolvedValue([]);
  mockHistoricalHours.mockResolvedValue([]);
});

describe("ride forecast hours route", () => {
  it("returns hour-by-hour ML predictions for the selected ride and date", async () => {
    mockMlHours.mockResolvedValue([
      { hour: 8, predictedWait: 20 },
      { hour: 9, predictedWait: 35 },
    ]);

    const response = await GET(request("2026-07-04"), context());

    expect(await response.json()).toEqual({
      rideId: 7,
      date: "2026-07-04",
      source: "ml",
      rows: [{ hour: 8, predictedWait: 20 }, { hour: 9, predictedWait: 35 }],
    });
    expect(mockMlHours).toHaveBeenCalledWith("2026-07-04", 7);
    expect(mockHistoricalHours).not.toHaveBeenCalled();
  });

  it("falls back to same-weekday historical hourly waits", async () => {
    mockHistoricalHours.mockResolvedValue([{ hour: 14, predictedWait: 50 }]);

    const response = await GET(request("2026-08-01"), context());

    expect(await response.json()).toEqual({
      rideId: 7,
      date: "2026-08-01",
      source: "historical",
      rows: [{ hour: 14, predictedWait: 50 }],
    });
    expect(mockHistoricalHours).toHaveBeenCalledWith("2026-08-01", 7);
  });

  it("returns unavailable when neither source has hourly data", async () => {
    const response = await GET(request("2026-08-01"), context());

    expect(await response.json()).toEqual({
      rideId: 7,
      date: "2026-08-01",
      source: "unavailable",
      rows: [],
    });
  });

  it("rejects invalid route or date input before querying", async () => {
    expect((await GET(request("2026-02-31"), context())).status).toBe(400);
    expect((await GET(request("2026-08-01"), context("not-a-number"))).status).toBe(400);
    expect(mockMlHours).not.toHaveBeenCalled();
  });
});
