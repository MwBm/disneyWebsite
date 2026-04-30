import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import { startOfDay, endOfDay } from "date-fns";
import { deriveCrowdScore } from "./crowd";

export async function getForecastForDate(date: Date) {
  return prisma.dailyForecast.findMany({
    where: {
      forecastFor: {
        gte: startOfDay(date),
        lte: endOfDay(date),
      },
    },
    orderBy: [{ forecastFor: "asc" }, { rideName: "asc" }],
  });
}

export async function getCrowdScoreForDate(date: Date): Promise<number | null> {
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

export type DayCrowdScore = {
  date: string;
  crowdScore: number | null;
  source: "ml" | "historical" | "groq" | null;
};

export async function getCrowdScoresForMonth(year: number, month: number): Promise<DayCrowdScore[]> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0); // last day of month
  const endOfLastDay = endOfDay(end);

  const [forecasts, histRows, dateContexts] = await Promise.all([
    prisma.dailyForecast.findMany({
      where: { forecastFor: { gte: start, lte: endOfLastDay } },
      select: { forecastFor: true, crowdScore: true },
    }),
    prisma.$queryRaw<{ dow: number; meanWait: number }[]>(Prisma.sql`
      SELECT
        EXTRACT(DOW FROM "recordedAt")::int AS dow,
        ROUND(AVG("waitTime"))::int AS "meanWait"
      FROM "WaitTimeRecord"
      WHERE "isOpen" = true
        AND "recordedAt" > NOW() - INTERVAL '90 days'
      GROUP BY dow
    `),
    prisma.dateContext.findMany({
      where: { date: { gte: start, lte: endOfLastDay } },
      select: { date: true, tier: true },
    }),
  ]);

  const mlByDate = new Map<string, number[]>();
  for (const f of forecasts) {
    const key = f.forecastFor.toISOString().slice(0, 10);
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

  const daysInMonth = end.getDate();
  const results: DayCrowdScore[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (mlByDate.has(key)) {
      const scores = mlByDate.get(key)!;
      results.push({
        date: key,
        crowdScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        source: "ml",
      });
    } else if (meanWaitByDow.has(date.getDay())) {
      const meanWait = meanWaitByDow.get(date.getDay())!;
      const tier = tierByDate.get(key);
      results.push({ date: key, crowdScore: deriveCrowdScore(meanWait, tier), source: "historical" });
    } else {
      results.push({ date: key, crowdScore: null, source: null });
    }
  }
  return results;
}

export async function getHistoricalMeansForDate(date: Date): Promise<HistoricalMean[]> {
  const dow = date.getDay(); // 0=Sunday..6=Saturday, matches PostgreSQL EXTRACT(DOW)
  const rows = await prisma.$queryRaw<HistoricalMean[]>(Prisma.sql`
    SELECT
      "rideId",
      "rideName",
      "landName",
      EXTRACT(HOUR FROM "recordedAt")::int AS hour,
      ROUND(AVG("waitTime"))::int AS "meanWait"
    FROM "WaitTimeRecord"
    WHERE
      "isOpen" = true
      AND EXTRACT(DOW FROM "recordedAt") = ${dow}
    GROUP BY "rideId", "rideName", "landName", EXTRACT(HOUR FROM "recordedAt")
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
