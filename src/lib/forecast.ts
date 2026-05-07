import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import { deriveCrowdScore } from "./crowd";
import {
  dateContextMonthRangeUtc,
  normalizeParkDateKey,
  parkDateDow,
  parkDateKey,
  parkDateRangeUtc,
  parkMonthRangeUtc,
} from "./park-time";

const PARK_LOCAL_RECORDED_AT = Prisma.raw(
  `("recordedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')`
);

export async function getForecastForDate(date: Date | string) {
  const { start, endExclusive } = parkDateRangeUtc(date);
  return prisma.dailyForecast.findMany({
    where: {
      forecastFor: {
        gte: start,
        lt: endExclusive,
      },
    },
    orderBy: [{ forecastFor: "asc" }, { rideName: "asc" }],
  });
}

export async function getCrowdScoreForDate(date: Date | string): Promise<number | null> {
  const forecasts = await getForecastForDate(date);
  if (forecasts.length === 0) return null;
  const scores = forecasts.map((f) => f.crowdScore);
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export async function getRecentCollectRuns(limit = 3) {
  return prisma.collectRun.findMany({
    orderBy: { ranAt: "desc" },
    take: limit,
  });
}

export type HistoricalMean = {
  rideId: number;
  rideName: string;
  landName: string;
  hour: number;
  meanWait: number;
};

export const ML_FORECAST_DAYS = 30;

export type DayCrowdScore = {
  date: string;
  crowdScore: number | null;
  source: "ml" | "historical" | "groq" | "unavailable" | null;
  tier: number | null;
  specialEvent: string | null;
  isHoliday: boolean;
};

export async function getCrowdScoresForMonth(year: number, month: number): Promise<DayCrowdScore[]> {
  const { start, endExclusive } = parkMonthRangeUtc(year, month);
  const dateContextRange = dateContextMonthRangeUtc(year, month);

  const [forecasts, histRows, dateContexts] = await Promise.all([
    prisma.dailyForecast.findMany({
      where: { forecastFor: { gte: start, lt: endExclusive } },
      select: { forecastFor: true, crowdScore: true },
    }),
    // Weighted same-month historical averages from HourlyWaitSummary.
    // Groups by park-local date first (to get a daily average across all rides/hours),
    // then computes a weighted average by day-of-week — recent same-month dates get 2x weight.
    prisma.$queryRaw<{ dow: number; meanWait: number }[]>(Prisma.sql`
      SELECT
        EXTRACT(DOW FROM sub.date)::int AS dow,
        ROUND(SUM(sub.avg_wait * sub.weight) / SUM(sub.weight))::int AS "meanWait"
      FROM (
        SELECT
          date,
          AVG("avgWait") AS avg_wait,
          CASE WHEN date >= NOW() - INTERVAL '1 year' THEN 2.0 ELSE 1.0 END AS weight
        FROM "HourlyWaitSummary"
        WHERE EXTRACT(MONTH FROM date) = ${month}
          AND date >= NOW() - INTERVAL '3 years'
        GROUP BY date
      ) sub
      GROUP BY EXTRACT(DOW FROM sub.date)
    `),
    prisma.dateContext.findMany({
      where: { date: { gte: dateContextRange.start, lt: dateContextRange.endExclusive } },
      select: { date: true, tier: true, specialEvent: true, isHoliday: true },
    }),
  ]);

  const mlByDate = new Map<string, number[]>();
  for (const f of forecasts) {
    const key = parkDateKey(f.forecastFor);
    if (!mlByDate.has(key)) mlByDate.set(key, []);
    mlByDate.get(key)!.push(f.crowdScore);
  }

  // Mean wait per DOW — kept raw so we can apply per-date tier multiplier
  const meanWaitByDow = new Map<number, number>(
    histRows.map((r) => [Number(r.dow), Number(r.meanWait)])
  );

  const tierByDate = new Map<string, number>(
    dateContexts
      .filter((c) => c.tier !== null)
      .map((c) => [c.date.toISOString().slice(0, 10), c.tier!])
  );

  const specialEventByDate = new Map<string, string>(
    dateContexts
      .filter((c) => c.specialEvent !== null)
      .map((c) => [c.date.toISOString().slice(0, 10), c.specialEvent!])
  );

  const isHolidayByDate = new Set<string>(
    dateContexts
      .filter((c) => c.isHoliday)
      .map((c) => c.date.toISOString().slice(0, 10))
  );

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const windowCutoff = new Date();
  windowCutoff.setDate(windowCutoff.getDate() + ML_FORECAST_DAYS);
  const windowCutoffKey = windowCutoff.toISOString().slice(0, 10);

  const results: DayCrowdScore[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const tier = tierByDate.get(key) ?? null;
    const specialEvent = specialEventByDate.get(key) ?? null;
    const isHoliday = isHolidayByDate.has(key);
    const beyondWindow = key > windowCutoffKey;

    if (mlByDate.has(key)) {
      const scores = mlByDate.get(key)!;
      results.push({
        date: key,
        crowdScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        source: "ml",
        tier,
        specialEvent,
        isHoliday,
      });
    } else if (!beyondWindow && meanWaitByDow.has(parkDateDow(key))) {
      const meanWait = meanWaitByDow.get(parkDateDow(key))!;
      results.push({ date: key, crowdScore: deriveCrowdScore(meanWait, tier ?? undefined), source: "historical", tier, specialEvent, isHoliday });
    } else if (beyondWindow) {
      results.push({ date: key, crowdScore: null, source: "unavailable", tier, specialEvent, isHoliday });
    } else {
      results.push({ date: key, crowdScore: null, source: null, tier, specialEvent, isHoliday });
    }
  }
  return results;
}

export async function getHistoricalMeansForDate(date: Date | string): Promise<HistoricalMean[]> {
  const dow = parkDateDow(normalizeParkDateKey(date)); // 0=Sunday..6=Saturday
  const rows = await prisma.$queryRaw<HistoricalMean[]>(Prisma.sql`
    SELECT
      "rideId",
      "rideName",
      "landName",
      EXTRACT(HOUR FROM ${PARK_LOCAL_RECORDED_AT})::int AS hour,
      ROUND(AVG("waitTime"))::int AS "meanWait"
    FROM "WaitTimeRecord"
    WHERE
      "isOpen" = true
      AND EXTRACT(DOW FROM ${PARK_LOCAL_RECORDED_AT}) = ${dow}
    GROUP BY "rideId", "rideName", "landName", EXTRACT(HOUR FROM ${PARK_LOCAL_RECORDED_AT})
    ORDER BY "rideId", hour
  `);
  // Prisma raw may return BigInt for int columns — normalize
  return rows.map((r) => ({
    rideId: Number(r.rideId),
    rideName: r.rideName,
    landName: r.landName,
    hour: Number(r.hour),
    meanWait: Number(r.meanWait),
  }));
}
