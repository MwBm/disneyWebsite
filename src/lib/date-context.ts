import { prisma } from "./db";
import { isHolidayDate, isSchoolBreakDate } from "./calendar";
import { fetchWeatherForecast, climatologicalWeather, WeatherDay } from "./weather";
import { fetchParkDateSchedules } from "./park-schedule";
import { mapWithConcurrency } from "./concurrency";
import { addParkDays, dateContextDate, parkDateKey } from "./park-time";

/**
 * Ceiling on parallel DateContext upserts in syncDateContext, which runs for
 * up to 365 dates per park.
 */
const SYNC_CONCURRENCY = 5;

// All date arithmetic uses UTC so results are timezone-independent.
// DateContext dates are stored as midnight UTC; getDate()/getMonth() would
// return the previous calendar day in negative-offset timezones.

export async function syncDateContext(
  days = 90
): Promise<{ synced: number; skipped: number }> {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startDate = parkDateKey(now);
  const endDate = addParkDays(startDate, days);

  const existing = await prisma.dateContext.findMany({
    where: {
      date: { gte: dateContextDate(startDate), lte: dateContextDate(endDate) },
      tierFetchedAt: { gte: staleThreshold },
    },
    select: { parkId: true, date: true },
  });

  const freshDates = new Set(existing.map((c) => `${c.parkId}:${c.date.toISOString().slice(0, 10)}`));
  const schedule = await fetchParkDateSchedules(startDate, endDate);
  const toSync = schedule.filter((s) => !freshDates.has(`${s.parkId}:${s.date}`));

  if (toSync.length === 0) return { synced: 0, skipped: schedule.length };

  const forecastCutoff = addParkDays(startDate, 16);
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
      const d = dateContextDate(s.date);
      const isHoliday = isHolidayDate(d);
      const isSchoolBreak = isSchoolBreakDate(d);
      const weather = weatherMap.get(s.date) ?? climatologicalWeather(s.date);
      return prisma.dateContext.upsert({
        where: { parkId_date: { parkId: s.parkId, date: d } },
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
          parkId: s.parkId,
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
