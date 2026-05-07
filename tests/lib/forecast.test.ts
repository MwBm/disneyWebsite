import { getCrowdScoresForMonth, ML_FORECAST_DAYS } from "@/lib/forecast";
import { prisma } from "@/lib/db";

const mockFindMany = prisma.dailyForecast.findMany as jest.Mock;
const mockQueryRaw = prisma.$queryRaw as jest.Mock;
const mockDateContextFindMany = prisma.dateContext.findMany as jest.Mock;

describe("getCrowdScoresForMonth", () => {
  beforeEach(() => jest.clearAllMocks());

  it("marks all days as unavailable for a month well beyond the 30-day window", async () => {
    mockFindMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);
    mockDateContextFindMany.mockResolvedValue([]);

    // 2030 is always beyond today + ML_FORECAST_DAYS
    const days = await getCrowdScoresForMonth(2030, 1);

    expect(days.length).toBe(31);
    expect(days.every((d) => d.source === "unavailable")).toBe(true);
    expect(days.every((d) => d.crowdScore === null)).toBe(true);
  });

  it("uses historical DOW means for past dates within the forecast window", async () => {
    // June 2025 is in the past — always before today+30
    // June 2, 2025 is a Monday (DOW=1 in PostgreSQL/park-time convention)
    mockFindMany.mockResolvedValue([]);
    // Prisma $queryRaw returns BigInt for integer columns
    mockQueryRaw.mockResolvedValue([{ dow: BigInt(1), meanWait: BigInt(45) }]);
    mockDateContextFindMany.mockResolvedValue([]);

    const days = await getCrowdScoresForMonth(2025, 6);

    const monday = days.find((d) => d.date === "2025-06-02");
    expect(monday).toBeDefined();
    expect(monday!.source).toBe("historical");
    expect(monday!.crowdScore).toBeGreaterThan(0);

    // Non-Monday days with no DOW mean → source: null (within window, no data)
    const tuesday = days.find((d) => d.date === "2025-06-03");
    expect(tuesday!.source).toBeNull();
  });

  it("prefers ML forecasts over historical fallback", async () => {
    // Two forecast slots for June 2, 2025 → crowd scores averaged
    mockFindMany.mockResolvedValue([
      { forecastFor: new Date("2025-06-02T19:00:00Z"), crowdScore: 55 },
      { forecastFor: new Date("2025-06-02T20:00:00Z"), crowdScore: 65 },
    ]);
    // Monday DOW mean also available — should be ignored for June 2 since ML wins
    mockQueryRaw.mockResolvedValue([{ dow: BigInt(1), meanWait: BigInt(30) }]);
    mockDateContextFindMany.mockResolvedValue([]);

    const days = await getCrowdScoresForMonth(2025, 6);

    const june2 = days.find((d) => d.date === "2025-06-02");
    expect(june2!.source).toBe("ml");
    expect(june2!.crowdScore).toBe(60); // average of 55 and 65
  });

  it("applies tier from DateContext to historical crowd score", async () => {
    // June 2025: Monday with tier=3
    mockFindMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([{ dow: BigInt(1), meanWait: BigInt(60) }]);
    mockDateContextFindMany.mockResolvedValue([
      { date: new Date("2025-06-02T00:00:00Z"), tier: 3, specialEvent: null, isHoliday: false },
    ]);

    const days = await getCrowdScoresForMonth(2025, 6);

    const monday = days.find((d) => d.date === "2025-06-02");
    expect(monday!.source).toBe("historical");
    expect(monday!.tier).toBe(3);
    // deriveCrowdScore(60, tier=3) should be higher than deriveCrowdScore(60, tier=0)
    const mondayNoTier = days.find((d) => d.date === "2025-06-09"); // next Monday, no tier
    expect(monday!.crowdScore!).toBeGreaterThan(mondayNoTier!.crowdScore ?? 0);
  });

  it("ML_FORECAST_DAYS is 30", () => {
    // Sync check: if this changes, verify the calendar UI still makes sense
    expect(ML_FORECAST_DAYS).toBe(30);
  });
});
