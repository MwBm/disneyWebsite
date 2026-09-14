import { Prisma } from "@prisma/client";
import {
  FORECAST_FIRST_LOCAL_HOUR,
  HISTORICAL_LOOKBACK_YEARS,
  getDailyMlCrowdScores,
  getHistoricalDowMeanWaits,
  getHistoricalRideWaitsForDate,
  getRecentCollectRuns,
  getRideForecastsForDate,
} from "@/lib/forecast-queries";
import { prisma } from "@/lib/db";

/**
 * Parameters and result normalisation only. Whether the SQL itself is right
 * (time zones, aggregates, filters) is checked against a real Postgres in
 * tests/integration/forecast-queries.test.ts.
 */

const mockQueryRaw = prisma.$queryRaw as jest.Mock;
const mockCollectRunFindMany = prisma.collectRun.findMany as jest.Mock;

function lastSql(): Prisma.Sql {
  return mockQueryRaw.mock.calls.at(-1)![0] as Prisma.Sql;
}

beforeEach(() => jest.clearAllMocks());

describe("getRideForecastsForDate", () => {
  it("bounds the query to the Pacific day", async () => {
    mockQueryRaw.mockResolvedValue([]);

    await getRideForecastsForDate("2026-11-01"); // DST ends: a 25-hour park day

    expect(lastSql().values).toEqual([new Date("2026-11-01T07:00:00Z"), new Date("2026-11-02T08:00:00Z")]);
    expect(lastSql().sql).toContain('GROUP BY "rideId"');
    expect(lastSql().sql).not.toContain("DISTINCT ON");
  });

  it("normalises BigInt and numeric strings to numbers", async () => {
    mockQueryRaw.mockResolvedValue([
      { rideId: BigInt(7), rideName: "R", landName: "L", avgWait: BigInt(31), peakWait: 50, mlConfidence: "0.72" },
    ]);

    expect(await getRideForecastsForDate("2026-06-01")).toEqual([
      { rideId: 7, rideName: "R", landName: "L", avgWait: 31, peakWait: 50, mlConfidence: 0.72 },
    ]);
  });
});

describe("getDailyMlCrowdScores", () => {
  it("returns a date-keyed map with numeric scores", async () => {
    mockQueryRaw.mockResolvedValue([
      { date: "2026-06-01", crowdScore: BigInt(41) },
      { date: "2026-06-02", crowdScore: 58 },
    ]);
    const start = new Date("2026-06-01T07:00:00Z");
    const end = new Date("2026-06-03T07:00:00Z");

    const scores = await getDailyMlCrowdScores(start, end);

    expect([...scores.entries()]).toEqual([["2026-06-01", 41], ["2026-06-02", 58]]);
    expect(lastSql().values).toEqual([start, end]);
    expect(lastSql().sql).toContain("AT TIME ZONE 'America/Los_Angeles'");
  });
});

describe("getHistoricalRideWaitsForDate", () => {
  it("filters by the date's day of week, forecast hours and lookback, from HourlyWaitSummary", async () => {
    mockQueryRaw.mockResolvedValue([]);

    await getHistoricalRideWaitsForDate("2026-09-15"); // a Tuesday

    expect(lastSql().values).toEqual([FORECAST_FIRST_LOCAL_HOUR, HISTORICAL_LOOKBACK_YEARS, 2]);
    expect(lastSql().sql).toContain('FROM "HourlyWaitSummary"');
    expect(lastSql().sql).not.toContain("WaitTimeRecord");
  });

  it("normalises numbers", async () => {
    mockQueryRaw.mockResolvedValue([{ rideId: BigInt(1), rideName: "R", landName: "L", avgWait: "40", peakWait: BigInt(66) }]);

    expect(await getHistoricalRideWaitsForDate("2026-09-15")).toEqual([
      { rideId: 1, rideName: "R", landName: "L", avgWait: 40, peakWait: 66 },
    ]);
  });
});

describe("getHistoricalDowMeanWaits", () => {
  it("returns a weekday-keyed map for the month", async () => {
    mockQueryRaw.mockResolvedValue([{ dow: BigInt(0), meanWait: BigInt(22) }, { dow: 6, meanWait: 35 }]);

    const means = await getHistoricalDowMeanWaits(12);

    expect([...means.entries()]).toEqual([[0, 22], [6, 35]]);
    expect(lastSql().values).toEqual([12]);
  });
});

describe("getRecentCollectRuns", () => {
  it("reads only collect-job runs, newest first", async () => {
    mockCollectRunFindMany.mockResolvedValue([]);

    await getRecentCollectRuns(3);

    expect(mockCollectRunFindMany).toHaveBeenCalledWith({
      where: { job: "collect" },
      orderBy: { ranAt: "desc" },
      take: 3,
    });
  });

  it("defaults to the last three runs", async () => {
    mockCollectRunFindMany.mockResolvedValue([]);

    await getRecentCollectRuns();

    expect(mockCollectRunFindMany.mock.calls[0][0].take).toBe(3);
  });
});
