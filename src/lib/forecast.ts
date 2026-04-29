import { prisma } from "./db";
import { startOfDay, endOfDay } from "date-fns";

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
