import { prisma } from "./db";
import { adjustCrowdScore } from "./groq";
import { isHolidayDate, isSchoolBreakDate } from "./calendar";
import { fetchWeatherForecast, climatologicalWeather, WeatherDay } from "./weather";
import { fetchDateSchedule } from "./park-schedule";

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
  await Promise.all(
    toSync.map((s) => {
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
    })
  );

  return { synced: toSync.length, skipped: freshDates.size };
}

export async function syncGroqAdjustments(days = 90): Promise<{ adjusted: number }> {
  const now = new Date();
  const startDate = now.toISOString().slice(0, 10);
  const endDate = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

  const pending = await prisma.dateContext.findMany({
    where: {
      date: { gte: new Date(startDate), lte: new Date(endDate) },
      groqAdjustment: null,
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

  const dateKeys = pending.map((c) => c.date);
  const forecasts = await prisma.dailyForecast.findMany({
    where: { forecastFor: { in: dateKeys } },
    select: { forecastFor: true, crowdScore: true },
  });
  const crowdByDate = new Map<string, number[]>();
  for (const f of forecasts) {
    const key = f.forecastFor.toISOString().slice(0, 10);
    if (!crowdByDate.has(key)) crowdByDate.set(key, []);
    crowdByDate.get(key)!.push(f.crowdScore);
  }

  let adjusted = 0;
  await Promise.all(
    pending.map(async (ctx) => {
      const dateKey = ctx.date.toISOString().slice(0, 10);
      const scores = crowdByDate.get(dateKey);
      const mlCrowdScore =
        scores && scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 50;

      const result = await adjustCrowdScore({
        date: dateKey,
        tier: ctx.tier ?? 0,
        isHoliday: ctx.isHoliday,
        isSchoolBreak: ctx.isSchoolBreak,
        hasSpecialEvent: ctx.specialEvent !== null,
        tempHigh: ctx.tempHigh,
        isRainy: ctx.isRainy ?? false,
        mlCrowdScore,
      });

      await prisma.dateContext.update({
        where: { id: ctx.id },
        data: { groqAdjustment: result.adjustment, groqReasoning: result.reasoning },
      });
      adjusted++;
    })
  );

  return { adjusted };
}
