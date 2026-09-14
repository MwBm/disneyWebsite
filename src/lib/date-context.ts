import { prisma } from "./db";
import { adjustCrowdScore } from "./groq";
import { isHolidayDate, isSchoolBreakDate } from "./calendar";
import { fetchWeatherForecast, climatologicalWeather, WeatherDay } from "./weather";
import { fetchDateSchedule } from "./park-schedule";
import { mapWithConcurrency } from "./concurrency";
import { parkDateRangeUtc } from "./park-time";
import { getDailyMlCrowdScores } from "./forecast-queries";

/**
 * Ceiling on parallel work in the sync jobs. Each unit is one Groq call plus
 * one database write, and these run for up to 365 dates.
 */
const SYNC_CONCURRENCY = 5;

// All date arithmetic uses UTC so results are timezone-independent.
// DateContext dates are stored as midnight UTC; getDate()/getMonth() would
// return the previous calendar day in negative-offset timezones.

export { isHolidayDate, isSchoolBreakDate } from "./calendar";
export { fetchDateSchedule } from "./park-schedule";

export async function syncDateContext(
  days = 90
): Promise<{ synced: number; skipped: number }> {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startDate = now.toISOString().slice(0, 10);
  const endDate = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

  const existing = await prisma.dateContext.findMany({
    where: {
      date: { gte: new Date(startDate), lte: new Date(endDate) },
      tierFetchedAt: { gte: staleThreshold },
    },
    select: { date: true },
  });

  const freshDates = new Set(existing.map((c) => c.date.toISOString().slice(0, 10)));
  const schedule = await fetchDateSchedule(startDate, endDate);
  const toSync = schedule.filter((s) => !freshDates.has(s.date));

  if (toSync.length === 0) return { synced: 0, skipped: schedule.length };

  const forecastCutoff = new Date(now.getTime() + 16 * 86_400_000).toISOString().slice(0, 10);
  const forecastEnd = toSync.some((s) => s.date <= forecastCutoff)
    ? forecastCutoff < endDate ? forecastCutoff : endDate
    : null;

  let weatherMap = new Map<string, WeatherDay>();
  if (forecastEnd) {
    try {
      weatherMap = await fetchWeatherForecast(startDate, forecastEnd);
    } catch {
      // Non-fatal: fall through to climatological normals for all dates
    }
  }

  const fetchedAt = new Date();
  const upserts = await mapWithConcurrency(toSync, SYNC_CONCURRENCY, (s) => {
      const d = new Date(s.date);
      const isHoliday = isHolidayDate(d);
      const isSchoolBreak = isSchoolBreakDate(d);
      const weather = weatherMap.get(s.date) ?? climatologicalWeather(s.date);
      return prisma.dateContext.upsert({
        where: { date: d },
        update: {
          tier: s.tier,
          specialEvent: s.specialEvent,
          isHoliday,
          isSchoolBreak,
          tierFetchedAt: fetchedAt,
          tierSource: "themeparks-wiki",
          tempHigh: weather.tempHigh,
          tempLow: weather.tempLow,
          precipMm: weather.precipMm,
          isRainy: weather.isRainy,
          weatherFetchedAt: fetchedAt,
        },
        create: {
          date: d,
          tier: s.tier,
          specialEvent: s.specialEvent,
          isHoliday,
          isSchoolBreak,
          tierFetchedAt: fetchedAt,
          tierSource: "themeparks-wiki",
          tempHigh: weather.tempHigh,
          tempLow: weather.tempLow,
          precipMm: weather.precipMm,
          isRainy: weather.isRainy,
          weatherFetchedAt: fetchedAt,
        },
      });
  });

  const failed = upserts.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(
      `syncDateContext: ${failed.length}/${toSync.length} upserts failed`,
      (failed[0] as PromiseRejectedResult).reason
    );
  }

  return { synced: toSync.length - failed.length, skipped: freshDates.size };
}

export async function syncGroqAdjustments(days = 90): Promise<{ adjusted: number }> {
  const now = new Date();
  const startDate = now.toISOString().slice(0, 10);
  const endDate = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

  const staleGroqThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const pending = await prisma.dateContext.findMany({
    where: {
      date: { gte: new Date(startDate), lte: new Date(endDate) },
      OR: [
        { groqAdjustment: null },
        { groqAdjustedAt: { lt: staleGroqThreshold } },
      ],
    },
    select: {
      id: true,
      date: true,
      tier: true,
      isHoliday: true,
      isSchoolBreak: true,
      specialEvent: true,
      tempHigh: true,
      isRainy: true,
    },
  });

  if (pending.length === 0) return { adjusted: 0 };

  // DateContext.date is midnight UTC standing for a park-local date, while
  // DailyForecast.forecastFor is a 30-minute slot inside that day, so match on
  // the park-day span rather than on timestamps.
  const pendingKeys = pending.map((c) => c.date.toISOString().slice(0, 10)).sort();
  const spanStart = parkDateRangeUtc(pendingKeys[0]).start;
  const spanEnd = parkDateRangeUtc(pendingKeys[pendingKeys.length - 1]).endExclusive;

  const crowdByDate = await getDailyMlCrowdScores(spanStart, spanEnd);

  const outcomes = await mapWithConcurrency(pending, SYNC_CONCURRENCY, async (ctx) => {
      const dateKey = ctx.date.toISOString().slice(0, 10);
      const mlCrowdScore = crowdByDate.get(dateKey) ?? 50;

      const result = await adjustCrowdScore({
        date: dateKey,
        tier: ctx.tier ?? 0,
        isHoliday: ctx.isHoliday,
        isSchoolBreak: ctx.isSchoolBreak,
        specialEvent: ctx.specialEvent,
        tempHigh: ctx.tempHigh,
        isRainy: ctx.isRainy ?? false,
        mlCrowdScore,
      });

      await prisma.dateContext.update({
        where: { id: ctx.id },
        data: { groqAdjustment: result.adjustment, groqReasoning: result.reasoning, groqAdjustedAt: new Date() },
      });
  });

  const failed = outcomes.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(
      `syncGroqAdjustments: ${failed.length}/${pending.length} updates failed`,
      (failed[0] as PromiseRejectedResult).reason
    );
  }

  return { adjusted: outcomes.length - failed.length };
}
