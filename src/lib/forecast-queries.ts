import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { PARK_TIME_ZONE, normalizeParkDateKey, parkDateDow, parkDateRangeUtc } from "./park-time";

/**
 * The SQL behind the forecast, calendar and crowd-score features.
 *
 * Every aggregate happens in Postgres. Each row a query returns counts against
 * Supabase's 5 GB/month egress quota, and these routes used to ship tens of
 * thousands of forecast rows to Node only to average them.
 *
 * Unit tests mock this module; tests/integration/forecast-queries.test.ts runs
 * every query here against a real Postgres.
 */

/**
 * First Pacific hour that has forecast slots. ml-service/pipeline.py skips
 * PARK_CLOSED_LOCAL_HOURS (0–7) when it writes DailyForecast, and the
 * historical fallback must average over the same hours or its numbers aren't
 * comparable. ml-service/tests/test_pipeline.py pins the two together.
 */
export const FORECAST_FIRST_LOCAL_HOUR = 8;

/** How far back the historical day-of-week fallback reads. */
export const HISTORICAL_LOOKBACK_YEARS = 2;

/** A Prisma.raw fragment: PARK_TIME_ZONE is a trusted constant, not input. */
const PARK_TZ_SQL = Prisma.raw(`'${PARK_TIME_ZONE}'`);

/** One ride's predictions for one park day. */
export type RideDayForecast = {
  rideId: number;
  rideName: string;
  landName: string;
  /** Mean predicted wait across the day's forecast slots (08:00–23:30 Pacific). */
  avgWait: number;
  /** Highest predicted wait in any of those slots. */
  peakWait: number;
  mlConfidence: number;
};

export type HistoricalRideWaits = Omit<RideDayForecast, "mlConfidence">;

/**
 * Per-ride average and peak predicted wait for one park date.
 *
 * Replaces a `DISTINCT ON ("rideId") … ORDER BY "mlConfidence" DESC` that was
 * meant to pick each ride's best slot. mlConfidence is one value per ride, so
 * every slot tied and Postgres returned an arbitrary one: on 2026-09-15 the 80
 * rides came back at 29 different times of day between 08:00 and 23:30, and
 * the table ranked a 2 PM wait against an 11:30 PM one.
 */
export async function getRideForecastsForDate(date: Date | string): Promise<RideDayForecast[]> {
  const { start, endExclusive } = parkDateRangeUtc(date);
  const rows = await prisma.$queryRaw<RideDayForecast[]>(Prisma.sql`
    SELECT
      "rideId",
      (array_agg("rideName" ORDER BY "createdAt" DESC))[1] AS "rideName",
      (array_agg("landName" ORDER BY "createdAt" DESC))[1] AS "landName",
      ROUND(AVG("predictedWait"))::int                    AS "avgWait",
      MAX("predictedWait")::int                           AS "peakWait",
      AVG("mlConfidence")::float                          AS "mlConfidence"
    FROM "DailyForecast"
    WHERE "forecastFor" >= ${start}
      AND "forecastFor" < ${endExclusive}
    GROUP BY "rideId"
    ORDER BY "rideId"
  `);
  return rows.map((r) => ({
    rideId: Number(r.rideId),
    rideName: r.rideName,
    landName: r.landName,
    avgWait: Number(r.avgWait),
    peakWait: Number(r.peakWait),
    mlConfidence: Number(r.mlConfidence),
  }));
}

/**
 * Park date ("YYYY-MM-DD") → mean ML crowd score over that date's slots.
 *
 * Returns at most one row per day. The calendar used to fetch every slot of
 * the month (~47,000 rows, ~1.3 MB per uncached month) and the Groq sync every
 * slot of the next year, only to compute these averages in Node.
 */
export async function getDailyMlCrowdScores(start: Date, endExclusive: Date): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ date: string; crowdScore: number }[]>(Prisma.sql`
    SELECT
      to_char(("forecastFor" AT TIME ZONE 'UTC' AT TIME ZONE ${PARK_TZ_SQL})::date, 'YYYY-MM-DD') AS date,
      ROUND(AVG("crowdScore"))::int                                                            AS "crowdScore"
    FROM "DailyForecast"
    WHERE "forecastFor" >= ${start}
      AND "forecastFor" < ${endExclusive}
    GROUP BY 1
    ORDER BY 1
  `);
  return new Map(rows.map((r) => [r.date, Number(r.crowdScore)]));
}

/**
 * Per-ride average and peak of typical hourly waits on this date's day of week.
 *
 * Reads HourlyWaitSummary. It used to read WaitTimeRecord, which only ever
 * holds ~30 days, so a "two-year" day-of-week mean was built from about four
 * weeks: 7 Tuesdays where the hourly archive has 52. It also scanned a
 * time-zone expression (1.1 s on production) and returned one row per ride
 * per hour, which the wait-times table then listed ~16 times per ride.
 *
 * `date` in HourlyWaitSummary is already the park date at midnight, so the day
 * of week needs no time-zone conversion. Only the hours that have forecast
 * slots count, so these numbers line up with getRideForecastsForDate.
 */
export async function getHistoricalRideWaitsForDate(date: Date | string): Promise<HistoricalRideWaits[]> {
  const dow = parkDateDow(normalizeParkDateKey(date)); // 0=Sunday..6=Saturday
  const rows = await prisma.$queryRaw<HistoricalRideWaits[]>(Prisma.sql`
    WITH hourly AS (
      SELECT "rideId", hour, AVG("avgWait") AS mean_wait
      FROM "HourlyWaitSummary"
      WHERE "isOpen"
        AND hour >= ${FORECAST_FIRST_LOCAL_HOUR}
        AND date >= NOW() - (${HISTORICAL_LOOKBACK_YEARS} * INTERVAL '1 year')
        AND EXTRACT(DOW FROM date) = ${dow}
      GROUP BY "rideId", hour
    ),
    names AS (
      SELECT DISTINCT ON ("rideId") "rideId", "rideName", "landName"
      FROM "HourlyWaitSummary"
      ORDER BY "rideId", date DESC, hour DESC
    )
    SELECT
      hourly."rideId",
      names."rideName",
      names."landName",
      ROUND(AVG(hourly.mean_wait))::int AS "avgWait",
      ROUND(MAX(hourly.mean_wait))::int AS "peakWait"
    FROM hourly
    JOIN names ON names."rideId" = hourly."rideId"
    GROUP BY hourly."rideId", names."rideName", names."landName"
    ORDER BY hourly."rideId"
  `);
  return rows.map((r) => ({
    rideId: Number(r.rideId),
    rideName: r.rideName,
    landName: r.landName,
    avgWait: Number(r.avgWait),
    peakWait: Number(r.peakWait),
  }));
}

/**
 * Day of week (0=Sunday) → mean wait on that weekday in `month`, over the last
 * three years of HourlyWaitSummary, with dates from the last year weighted 2×.
 */
export async function getHistoricalDowMeanWaits(month: number): Promise<Map<number, number>> {
  const rows = await prisma.$queryRaw<{ dow: number; meanWait: number }[]>(Prisma.sql`
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
  `);
  return new Map(rows.map((r) => [Number(r.dow), Number(r.meanWait)]));
}

/**
 * Most recent runs of the 30-minute collect job only.
 *
 * CollectRun also holds train and archive runs. Without the filter a daily
 * train run could stand in for "last collected", and 47 collect successes
 * would hide a train job that fails every night (or the reverse).
 */
export async function getRecentCollectRuns(limit = 3) {
  return prisma.collectRun.findMany({
    where: { job: "collect" },
    orderBy: { ranAt: "desc" },
    take: limit,
  });
}
