import { prisma } from "@/lib/db";
import {
  FORECAST_FIRST_LOCAL_HOUR,
  getDailyMlCrowdScores,
  getHistoricalDowMeanWaits,
  getHistoricalRideForecastHoursForDate,
  getHistoricalRideWaitsForDate,
  getRecentCollectRuns,
  getRideForecastHoursForDate,
  getRideForecastsForDate,
} from "@/lib/forecast-queries";
import { getCrowdScoreForDate, getCrowdScoresForMonth } from "@/lib/forecast";
import { describeWithDatabase, pacific, truncateAppTables } from "./db";

/** The SQL in src/lib/forecast-queries.ts against a real Postgres with the Prisma migrations applied. */

let seq = 0;
function forecastRow(rideId: number, forecastFor: Date, predictedWait: number, extra: Partial<{
  rideName: string; landName: string; crowdScore: number; mlConfidence: number; createdAt: Date;
}> = {}) {
  seq += 1;
  return {
    id: `f-${seq}`,
    rideId,
    rideName: extra.rideName ?? `Ride ${rideId}`,
    landName: extra.landName ?? "Land",
    forecastFor,
    predictedWait,
    crowdScore: extra.crowdScore ?? 50,
    mlConfidence: extra.mlConfidence ?? 0.5,
    createdAt: extra.createdAt ?? new Date("2026-05-31T06:00:00Z"),
  };
}

function hourlyRow(rideId: number, date: string, hour: number, avgWait: number, extra: Partial<{
  isOpen: boolean; rideName: string; landName: string;
}> = {}) {
  seq += 1;
  return {
    id: `h-${seq}`,
    rideId,
    rideName: extra.rideName ?? `Ride ${rideId}`,
    landName: extra.landName ?? "Land",
    date: new Date(`${date}T00:00:00Z`),
    hour,
    avgWait,
    peakWait: Math.ceil(avgWait),
    sampleCount: 2,
    isOpen: extra.isOpen ?? true,
  };
}

function projectionDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function rideDayRow(rideId: number, date: string, avgWait: number, peakWait: number, mlConfidence = 0.5) {
  seq += 1;
  return {
    id: `r-${seq}`,
    parkId: 16,
    rideId,
    date: projectionDate(date),
    avgWait,
    peakWait,
    mlConfidence,
  };
}

async function seedCatalog(...rideIds: number[]) {
  await prisma.rideCatalog.createMany({
    data: rideIds.map((rideId) => ({
      parkId: 16,
      rideId,
      rideName: `Ride ${rideId}`,
      landName: "Land",
    })),
  });
}

/** "YYYY-MM-DD" of weekday `dow` (0=Sunday) in the week `weeksAgo` weeks before this one (UTC). */
function recentWeekday(dow: number, weeksAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7) - 7 * weeksAgo);
  return d.toISOString().slice(0, 10);
}

describeWithDatabase("forecast queries on Postgres", () => {
  beforeEach(truncateAppTables);
  afterAll(() => prisma.$disconnect());

  describe("getRideForecastsForDate", () => {
    it("reads one compact average/peak row per ride from the serving projection", async () => {
      await seedCatalog(1, 2);
      await prisma.rideDayForecast.createMany({
        data: [
          rideDayRow(1, "2026-06-01", 25, 45),
          rideDayRow(1, "2026-06-02", 999, 999),
          rideDayRow(2, "2026-06-01", 30, 30, 0.8),
        ],
      });

      const rides = await getRideForecastsForDate("2026-06-01");

      expect(rides).toEqual([
        { rideId: 1, rideName: "Ride 1", landName: "Land", avgWait: 25, peakWait: 45, mlConfidence: 0.5 },
        { rideId: 2, rideName: "Ride 2", landName: "Land", avgWait: 30, peakWait: 30, mlConfidence: 0.8 },
      ]);
    });

    it("returns nothing for a day without forecasts", async () => {
      expect(await getRideForecastsForDate("2026-06-01")).toEqual([]);
    });
  });

  describe("getRideForecastHoursForDate", () => {
    it("groups 30-minute forecast slots into one Pacific-hour point", async () => {
      await prisma.dailyForecast.createMany({
        data: [
          forecastRow(1, pacific("2026-06-01T09:00:00", -7), 20),
          forecastRow(1, pacific("2026-06-01T09:30:00", -7), 40),
          forecastRow(1, pacific("2026-06-01T10:00:00", -7), 55),
          forecastRow(1, pacific("2026-06-02T09:00:00", -7), 999),
        ],
      });

      expect(await getRideForecastHoursForDate("2026-06-01", 1)).toEqual([
        { hour: 9, predictedWait: 30 },
        { hour: 10, predictedWait: 55 },
      ]);
    });
  });

  describe("getDailyMlCrowdScores / getCrowdScoreForDate", () => {
    it("reads one precomputed busy-period score per park day", async () => {
      await prisma.parkDayForecast.createMany({
        data: [
          { id: "p-1", parkId: 16, date: projectionDate("2026-06-01"), crowdScore: 50 },
          { id: "p-2", parkId: 16, date: projectionDate("2026-06-02"), crowdScore: 70 },
        ],
      });

      const scores = await getDailyMlCrowdScores(pacific("2026-06-01T00:00:00", -7), pacific("2026-06-03T00:00:00", -7));

      expect([...scores.entries()]).toEqual([["2026-06-01", 50], ["2026-06-02", 70]]);
      expect(await getCrowdScoreForDate("2026-06-01")).toBe(50);
      expect(await getCrowdScoreForDate("2026-06-03")).toBeNull();
    });

    it("returns one row per day however many source slots a month had", async () => {
      const data = [];
      for (let day = 1; day <= 30; day++) {
        data.push({ id: `p-month-${day}`, parkId: 16, date: projectionDate(`2026-06-${String(day).padStart(2, "0")}`), crowdScore: 50 });
      }
      await prisma.parkDayForecast.createMany({ data });

      const scores = await getDailyMlCrowdScores(pacific("2026-06-01T00:00:00", -7), pacific("2026-07-01T00:00:00", -7));
      expect(data.length).toBe(30);
      expect(scores.size).toBe(30);
    });
  });

  describe("getHistoricalRideWaitsForDate", () => {
    it("averages typical hourly waits on the same weekday, open forecast hours only", async () => {
      const tuesday = recentWeekday(2, 1);
      const earlierTuesday = recentWeekday(2, 2);
      const wednesday = recentWeekday(3, 1);
      await prisma.hourlyWaitSummary.createMany({
        data: [
          hourlyRow(1, tuesday, 8, 20),
          hourlyRow(1, tuesday, 14, 60),
          hourlyRow(1, earlierTuesday, 14, 40), // hour 14 averages to 50
          hourlyRow(1, tuesday, FORECAST_FIRST_LOCAL_HOUR - 1, 500), // before forecast hours
          hourlyRow(1, earlierTuesday, 15, 900, { isOpen: false }), // closed
          hourlyRow(1, wednesday, 14, 700), // other weekday
          hourlyRow(1, "2023-01-03", 14, 800), // a Tuesday outside the lookback
        ],
      });

      const [ride] = await getHistoricalRideWaitsForDate(tuesday);

      expect(ride).toEqual({ rideId: 1, rideName: "Ride 1", landName: "Land", avgWait: 35, peakWait: 50 });
    });

    it("returns one row per ride and the ride's latest name", async () => {
      const tuesday = recentWeekday(2, 1);
      const earlierTuesday = recentWeekday(2, 3);
      await prisma.hourlyWaitSummary.createMany({
        data: [
          hourlyRow(5, earlierTuesday, 10, 10, { rideName: "Old Name" }),
          ...Array.from({ length: 16 }, (_, i) => hourlyRow(5, tuesday, 8 + i, 30, { rideName: "New Name" })),
          hourlyRow(6, tuesday, 12, 15),
        ],
      });

      const rides = await getHistoricalRideWaitsForDate(tuesday);

      expect(rides.map((r) => [r.rideId, r.rideName])).toEqual([[5, "New Name"], [6, "Ride 6"]]);
    });

    it("names a ride from its newest archive row even when that row is left out of the averages", async () => {
      const tuesday = recentWeekday(2, 1);
      await prisma.hourlyWaitSummary.createMany({
        data: [
          hourlyRow(7, tuesday, 12, 40, { rideName: "Old Name", landName: "Old Land" }),
          hourlyRow(7, tuesday, 23, 900, { rideName: "Renamed", landName: "New Land", isOpen: false }),
          hourlyRow(8, tuesday, 12, 50, { isOpen: false }), // no open hours: no row at all
        ],
      });

      expect(await getHistoricalRideWaitsForDate(tuesday)).toEqual([
        { rideId: 7, rideName: "Renamed", landName: "New Land", avgWait: 40, peakWait: 40 },
      ]);
    });

    it("ignores raw WaitTimeRecord rows entirely", async () => {
      const tuesday = recentWeekday(2, 1);
      await prisma.waitTimeRecord.create({
        data: {
          rideId: 1, rideName: "R", landName: "L", waitTime: 45, isOpen: true,
          windowedAt: new Date(`${tuesday}T20:00:00Z`), recordedAt: new Date(`${tuesday}T20:00:00Z`),
        },
      });

      expect(await getHistoricalRideWaitsForDate(tuesday)).toEqual([]);
    });
  });

  describe("getHistoricalRideForecastHoursForDate", () => {
    it("returns open same-weekday hourly averages for a selected ride", async () => {
      const tuesday = recentWeekday(2, 1);
      const earlierTuesday = recentWeekday(2, 2);
      const wednesday = recentWeekday(3, 1);
      await prisma.hourlyWaitSummary.createMany({
        data: [
          hourlyRow(1, tuesday, 9, 20),
          hourlyRow(1, earlierTuesday, 9, 40),
          hourlyRow(1, tuesday, 10, 70),
          hourlyRow(1, tuesday, 11, 99, { isOpen: false }),
          hourlyRow(1, wednesday, 9, 999),
          hourlyRow(2, tuesday, 9, 999),
        ],
      });

      expect(await getHistoricalRideForecastHoursForDate(tuesday, 1)).toEqual([
        { hour: 9, predictedWait: 30 },
        { hour: 10, predictedWait: 70 },
      ]);
    });
  });

  describe("getHistoricalDowMeanWaits", () => {
    it("weights the last year twice as much as older years, within the month", async () => {
      // A Monday two weeks ago is always inside "the last year"; the same
      // month two years earlier is always outside it but inside three years.
      const recentMonday = recentWeekday(1, 2);
      const month = Number(recentMonday.slice(5, 7));
      const olderSameMonth = `${Number(recentMonday.slice(0, 4)) - 2}${recentMonday.slice(4, 8)}01`;
      const otherMonth = `${recentMonday.slice(0, 5)}${String((month % 12) + 1).padStart(2, "0")}-01`;
      await prisma.hourlyWaitSummary.createMany({
        data: [
          hourlyRow(1, recentMonday, 12, 60),
          hourlyRow(1, olderSameMonth, 12, 30),
          hourlyRow(1, otherMonth, 12, 999),
        ],
      });
      const olderDow = new Date(`${olderSameMonth}T00:00:00Z`).getUTCDay();

      const means = await getHistoricalDowMeanWaits(month);

      if (olderDow === 1) {
        expect(means.get(1)).toBe(50); // (60×2 + 30×1) / 3
      } else {
        expect(means.get(1)).toBe(60);
        expect(means.get(olderDow)).toBe(30);
      }
      expect([...means.values()]).not.toContain(999);
    });
  });

  describe("getRecentCollectRuns", () => {
    it("filters by the JobKind enum, newest first", async () => {
      await prisma.collectRun.createMany({
        data: [
          { job: "collect", ranAt: new Date("2026-09-14T01:00:00Z"), rowsUpserted: 56, success: true },
          { job: "train", ranAt: new Date("2026-09-14T06:00:00Z"), rowsUpserted: 75_000, success: true },
          { job: "collect", ranAt: new Date("2026-09-14T01:30:00Z"), rowsUpserted: 0, success: false },
          { job: "archive", ranAt: new Date("2026-09-14T09:00:00Z"), rowsUpserted: 0, success: true },
        ],
      });

      const runs = await getRecentCollectRuns(3);

      expect(runs.map((r) => [r.job, r.ranAt.toISOString()])).toEqual([
        ["collect", "2026-09-14T01:30:00.000Z"],
        ["collect", "2026-09-14T01:00:00.000Z"],
      ]);
    });
  });

  describe("getCrowdScoresForMonth", () => {
    it("combines SQL daily scores with stored Groq adjustments", async () => {
      // An ML score wins whatever the date's position relative to the forecast window.
      await prisma.dailyForecast.createMany({
        data: [
          forecastRow(1, pacific("2026-06-15T10:00:00", -7), 1, { crowdScore: 40 }),
          forecastRow(2, pacific("2026-06-15T23:30:00", -7), 1, { crowdScore: 50 }),
        ],
      });
      await prisma.dateContext.create({
        data: { date: new Date("2026-06-15T00:00:00Z"), groqAdjustment: 6, tier: 2 },
      });

      const days = await getCrowdScoresForMonth(2026, 6);

      expect(days).toHaveLength(30);
      expect(days.find((d) => d.date === "2026-06-15")).toMatchObject({ source: "ml", crowdScore: 51, tier: 2 });
      expect(days.find((d) => d.date === "2026-06-16")!.source).not.toBe("ml");
    });
  });
});
