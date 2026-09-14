import { prisma } from "@/lib/db";
import {
  FORECAST_FIRST_LOCAL_HOUR,
  getDailyMlCrowdScores,
  getHistoricalDowMeanWaits,
  getHistoricalRideWaitsForDate,
  getRecentCollectRuns,
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
    it("averages and peaks each ride over exactly its Pacific day", async () => {
      await prisma.dailyForecast.createMany({
        data: [
          forecastRow(1, pacific("2026-06-01T08:00:00", -7), 10),
          forecastRow(1, pacific("2026-06-01T14:00:00", -7), 45),
          forecastRow(1, pacific("2026-06-01T23:30:00", -7), 20), // 06:30 UTC Jun 2, still Jun 1 in Anaheim
          forecastRow(1, pacific("2026-06-02T00:00:00", -7), 999), // next park day
          forecastRow(1, pacific("2026-05-31T23:30:00", -7), 999), // previous park day
          forecastRow(2, pacific("2026-06-01T12:00:00", -7), 30, { mlConfidence: 0.8 }),
        ],
      });

      const rides = await getRideForecastsForDate("2026-06-01");

      expect(rides).toEqual([
        { rideId: 1, rideName: "Ride 1", landName: "Land", avgWait: 25, peakWait: 45, mlConfidence: 0.5 },
        { rideId: 2, rideName: "Ride 2", landName: "Land", avgWait: 30, peakWait: 30, mlConfidence: 0.8 },
      ]);
    });

    it("rounds a half-minute average up and keeps the newest name", async () => {
      await prisma.dailyForecast.createMany({
        data: [
          forecastRow(312, pacific("2026-06-01T09:00:00", -7), 40, {
            rideName: "Soarin' Over California", createdAt: new Date("2026-05-01T06:00:00Z"),
          }),
          forecastRow(312, pacific("2026-06-01T10:00:00", -7), 41, {
            rideName: "Soarin' Around the World", createdAt: new Date("2026-05-31T06:00:00Z"),
          }),
        ],
      });

      const [ride] = await getRideForecastsForDate("2026-06-01");

      expect(ride.avgWait).toBe(41); // 40.5 → 41
      expect(ride.rideName).toBe("Soarin' Around the World");
    });

    it("covers a 25-hour park day at the end of daylight time", async () => {
      await prisma.dailyForecast.createMany({
        data: [
          forecastRow(1, new Date("2026-11-02T07:30:00Z"), 60), // 23:30 PST Nov 1
          forecastRow(1, new Date("2026-11-02T08:00:00Z"), 999), // 00:00 PST Nov 2
        ],
      });

      expect((await getRideForecastsForDate("2026-11-01"))[0].peakWait).toBe(60);
    });

    it("returns nothing for a day without forecasts", async () => {
      expect(await getRideForecastsForDate("2026-06-01")).toEqual([]);
    });
  });

  describe("getDailyMlCrowdScores / getCrowdScoreForDate", () => {
    it("groups slots by Pacific date and rounds each day's mean", async () => {
      await prisma.dailyForecast.createMany({
        data: [
          forecastRow(1, pacific("2026-06-01T09:00:00", -7), 1, { crowdScore: 10 }),
          forecastRow(2, pacific("2026-06-01T23:30:00", -7), 1, { crowdScore: 11 }), // UTC date is Jun 2
          forecastRow(1, pacific("2026-06-02T09:00:00", -7), 1, { crowdScore: 70 }),
        ],
      });

      const scores = await getDailyMlCrowdScores(pacific("2026-06-01T00:00:00", -7), pacific("2026-06-03T00:00:00", -7));

      expect([...scores.entries()]).toEqual([["2026-06-01", 11], ["2026-06-02", 70]]); // 10.5 → 11
      expect(await getCrowdScoreForDate("2026-06-01")).toBe(11);
      expect(await getCrowdScoreForDate("2026-06-03")).toBeNull();
    });

    it("returns one row per day however many slots a month has", async () => {
      const data = [];
      for (let day = 1; day <= 30; day++) {
        for (let hour = 8; hour < 24; hour++) {
          for (const rideId of [1, 2, 3]) {
            data.push(forecastRow(rideId, pacific(`2026-06-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00`, -7), 1));
          }
        }
      }
      await prisma.dailyForecast.createMany({ data });

      const scores = await getDailyMlCrowdScores(pacific("2026-06-01T00:00:00", -7), pacific("2026-07-01T00:00:00", -7));
      expect(data.length).toBe(1440);
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
