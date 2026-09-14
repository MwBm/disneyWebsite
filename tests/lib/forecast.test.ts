import { getCrowdScoreForDate, getCrowdScoresForMonth, ML_FORECAST_DAYS, resolveCrowdScore } from "@/lib/forecast";
import * as queries from "@/lib/forecast-queries";
import { prisma } from "@/lib/db";

/** Crowd-score logic with each query in forecast-queries.ts mocked separately. */
jest.mock("@/lib/forecast-queries", () => ({
  getDailyMlCrowdScores: jest.fn(),
  getHistoricalDowMeanWaits: jest.fn(),
}));

const mockDailyScores = queries.getDailyMlCrowdScores as jest.Mock;
const mockDowMeans = queries.getHistoricalDowMeanWaits as jest.Mock;
const mockDateContextFindMany = prisma.dateContext.findMany as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockDailyScores.mockResolvedValue(new Map());
  mockDowMeans.mockResolvedValue(new Map());
  mockDateContextFindMany.mockResolvedValue([]);
});

describe("getCrowdScoresForMonth", () => {
  it("marks all days as unavailable for a month well beyond the 30-day window", async () => {
    // 2030 is always beyond today + ML_FORECAST_DAYS
    const days = await getCrowdScoresForMonth(2030, 1);

    expect(days.length).toBe(31);
    expect(days.every((d) => d.source === "unavailable")).toBe(true);
    expect(days.every((d) => d.crowdScore === null)).toBe(true);
  });

  it("returns every day of a leap-year February", async () => {
    const days = await getCrowdScoresForMonth(2028, 2);
    expect(days.map((d) => d.date).slice(-2)).toEqual(["2028-02-28", "2028-02-29"]);
  });

  it("reads ML scores for the park-local month range and historical means for that month", async () => {
    await getCrowdScoresForMonth(2026, 6);

    // Jun 1 00:00 PDT = 07:00 UTC; Jul 1 00:00 PDT = 07:00 UTC.
    expect(mockDailyScores).toHaveBeenCalledWith(new Date("2026-06-01T07:00:00Z"), new Date("2026-07-01T07:00:00Z"));
    expect(mockDowMeans).toHaveBeenCalledWith(6);
  });

  it("uses historical DOW means for past dates within the forecast window", async () => {
    // June 2, 2025 is a Monday (DOW=1)
    mockDowMeans.mockResolvedValue(new Map([[1, 45]]));

    const days = await getCrowdScoresForMonth(2025, 6);

    const monday = days.find((d) => d.date === "2025-06-02");
    expect(monday!.source).toBe("historical");
    expect(monday!.crowdScore).toBeGreaterThan(0);

    // Non-Monday days with no DOW mean → source: null (within window, no data)
    const tuesday = days.find((d) => d.date === "2025-06-03");
    expect(tuesday!.source).toBeNull();
  });

  it("prefers the ML daily score over the historical fallback", async () => {
    mockDailyScores.mockResolvedValue(new Map([["2025-06-02", 60]]));
    mockDowMeans.mockResolvedValue(new Map([[1, 30]]));

    const days = await getCrowdScoresForMonth(2025, 6);

    const june2 = days.find((d) => d.date === "2025-06-02");
    expect(june2!.source).toBe("ml");
    expect(june2!.crowdScore).toBe(60);
  });

  it("applies and clamps the stored Groq adjustment to ML scores", async () => {
    mockDailyScores.mockResolvedValue(new Map([["2025-06-02", 60], ["2025-06-03", 95], ["2025-06-04", 5]]));
    mockDateContextFindMany.mockResolvedValue([
      { date: new Date("2025-06-02T00:00:00Z"), tier: null, specialEvent: null, isHoliday: false, groqAdjustment: 7.4 },
      { date: new Date("2025-06-03T00:00:00Z"), tier: null, specialEvent: null, isHoliday: false, groqAdjustment: 20 },
      { date: new Date("2025-06-04T00:00:00Z"), tier: null, specialEvent: null, isHoliday: false, groqAdjustment: -20 },
    ]);

    const days = await getCrowdScoresForMonth(2025, 6);
    const score = (date: string) => days.find((d) => d.date === date)!.crowdScore;

    expect(score("2025-06-02")).toBe(67);
    expect(score("2025-06-03")).toBe(100);
    expect(score("2025-06-04")).toBe(0);
  });

  it("applies tier from DateContext to historical crowd score", async () => {
    mockDowMeans.mockResolvedValue(new Map([[1, 60]]));
    mockDateContextFindMany.mockResolvedValue([
      { date: new Date("2025-06-02T00:00:00Z"), tier: 3, specialEvent: null, isHoliday: false, groqAdjustment: null },
    ]);

    const days = await getCrowdScoresForMonth(2025, 6);

    const monday = days.find((d) => d.date === "2025-06-02");
    expect(monday!.source).toBe("historical");
    expect(monday!.tier).toBe(3);
    const mondayNoTier = days.find((d) => d.date === "2025-06-09"); // next Monday, no tier
    expect(monday!.crowdScore!).toBeGreaterThan(mondayNoTier!.crowdScore ?? 0);
  });

  it("copies special events and holidays from DateContext, defaulting when absent", async () => {
    mockDateContextFindMany.mockResolvedValue([
      { date: new Date("2025-07-04T00:00:00Z"), tier: 5, specialEvent: "Fireworks", isHoliday: true, groqAdjustment: null },
    ]);

    const days = await getCrowdScoresForMonth(2025, 7);
    const july4 = days.find((d) => d.date === "2025-07-04")!;
    const july5 = days.find((d) => d.date === "2025-07-05")!;

    expect([july4.tier, july4.specialEvent, july4.isHoliday]).toEqual([5, "Fireworks", true]);
    expect([july5.tier, july5.specialEvent, july5.isHoliday]).toEqual([null, null, false]);
  });

  it("ML_FORECAST_DAYS is 30", () => {
    // Sync check: if this changes, verify the calendar UI still makes sense
    expect(ML_FORECAST_DAYS).toBe(30);
  });
});

describe("getCrowdScoreForDate", () => {
  it("returns the daily score for that park date", async () => {
    mockDailyScores.mockResolvedValue(new Map([["2026-06-01", 42]]));

    expect(await getCrowdScoreForDate("2026-06-01")).toBe(42);
    expect(mockDailyScores).toHaveBeenCalledWith(new Date("2026-06-01T07:00:00Z"), new Date("2026-06-02T07:00:00Z"));
  });

  it("returns null when no forecast covers the date", async () => {
    expect(await getCrowdScoreForDate("2026-06-01")).toBeNull();
  });

  it("keys a Date argument by its Pacific date, not its UTC date", async () => {
    // 03:00 UTC on Jun 2 is still 20:00 on Jun 1 in Anaheim.
    mockDailyScores.mockResolvedValue(new Map([["2026-06-01", 33], ["2026-06-02", 99]]));

    expect(await getCrowdScoreForDate(new Date("2026-06-02T03:00:00Z"))).toBe(33);
  });
});

describe("resolveCrowdScore", () => {
  it.each([
    [{ mlScore: 10, historicalScore: 20, groqScore: 30, isBeyondWindow: true }, { crowdScore: 10, source: "ml" }],
    [{ mlScore: null, historicalScore: 20, groqScore: 30, isBeyondWindow: false }, { crowdScore: 20, source: "historical" }],
    [{ mlScore: null, historicalScore: null, groqScore: 30, isBeyondWindow: false }, { crowdScore: 30, source: "groq" }],
    [{ mlScore: null, historicalScore: 20, groqScore: 30, isBeyondWindow: true }, { crowdScore: null, source: "unavailable" }],
    [{ mlScore: null, historicalScore: null, groqScore: null, isBeyondWindow: false }, { crowdScore: null, source: null }],
    [{ mlScore: 0, historicalScore: 20, groqScore: null, isBeyondWindow: false }, { crowdScore: 0, source: "ml" }],
  ])("%j → %j", (input, expected) => {
    expect(resolveCrowdScore(input)).toEqual(expected);
  });
});
