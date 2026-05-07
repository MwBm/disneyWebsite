import { prisma } from "./db";
import { adjustCrowdScore } from "./groq";

const DISNEYLAND_PARK_ID = "7340550b-c14d-4def-80bb-acdb51d49a66";
const THEMEPARKS_API_BASE = "https://api.themeparks.wiki/v1";

// Anaheim, CA coordinates for Open-Meteo
const ANAHEIM_LAT = 33.8366;
const ANAHEIM_LON = -117.9143;

// Climatological monthly means for Anaheim (°F high, °F low, precip mm/day)
// Source: NOAA 30-year normals. Used when date > 16 days out (Open-Meteo forecast limit).
const ANAHEIM_MONTHLY_NORMALS: Record<number, { tempHigh: number; tempLow: number; precipMm: number }> = {
  1:  { tempHigh: 68, tempLow: 48, precipMm: 2.5 },
  2:  { tempHigh: 69, tempLow: 49, precipMm: 2.5 },
  3:  { tempHigh: 72, tempLow: 52, precipMm: 1.5 },
  4:  { tempHigh: 76, tempLow: 55, precipMm: 0.5 },
  5:  { tempHigh: 80, tempLow: 60, precipMm: 0.1 },
  6:  { tempHigh: 86, tempLow: 64, precipMm: 0.0 },
  7:  { tempHigh: 93, tempLow: 69, precipMm: 0.0 },
  8:  { tempHigh: 93, tempLow: 70, precipMm: 0.1 },
  9:  { tempHigh: 89, tempLow: 67, precipMm: 0.3 },
  10: { tempHigh: 81, tempLow: 61, precipMm: 0.5 },
  11: { tempHigh: 73, tempLow: 53, precipMm: 1.5 },
  12: { tempHigh: 67, tempLow: 47, precipMm: 2.0 },
};

type WeatherDay = {
  date: string;         // YYYY-MM-DD
  tempHigh: number;     // °F
  tempLow: number;      // °F
  precipMm: number;
  isRainy: boolean;
};

async function fetchWeatherForecast(startDate: string, endDate: string): Promise<Map<string, WeatherDay>> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${ANAHEIM_LAT}&longitude=${ANAHEIM_LON}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&temperature_unit=fahrenheit` +
    `&precipitation_unit=mm` +
    `&timezone=America%2FLos_Angeles` +
    `&start_date=${startDate}&end_date=${endDate}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);

  const data = await res.json() as {
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_sum: number[];
    };
  };

  const map = new Map<string, WeatherDay>();
  for (let i = 0; i < data.daily.time.length; i++) {
    const precipMm = data.daily.precipitation_sum[i] ?? 0;
    map.set(data.daily.time[i], {
      date: data.daily.time[i],
      tempHigh: data.daily.temperature_2m_max[i] ?? 75,
      tempLow: data.daily.temperature_2m_min[i] ?? 55,
      precipMm,
      isRainy: precipMm >= 2.5,
    });
  }
  return map;
}

function climatologicalWeather(dateStr: string): WeatherDay {
  const month = parseInt(dateStr.slice(5, 7), 10);
  const n = ANAHEIM_MONTHLY_NORMALS[month]!;
  return { date: dateStr, tempHigh: n.tempHigh, tempLow: n.tempLow, precipMm: n.precipMm, isRainy: n.precipMm >= 2.5 };
}

// All date arithmetic uses UTC so results are timezone-independent.
// DateContext dates are stored as midnight UTC; getDate()/getMonth() would
// return the previous calendar day in negative-offset timezones.

// Meeus/Jones/Butcher algorithm — returns Easter Sunday in UTC.
function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m2 = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m2 + 114) / 31);
  const day = ((h + l - 7 * m2 + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function nthWeekday(year: number, month: number, dow: number, n: number): Date {
  // month: 1-indexed, dow: 0=Sun..6=Sat
  // n > 0: nth from start; -1 = last occurrence
  if (n > 0) {
    let day = 1, count = 0;
    while (day <= 50) {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (d.getUTCMonth() !== month - 1) break;
      if (d.getUTCDay() === dow) { count++; if (count === n) return d; }
      day++;
    }
    throw new Error(`nthWeekday: no result year=${year} month=${month} dow=${dow} n=${n}`);
  } else {
    for (let day = 31; day >= 1; day--) {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (d.getUTCMonth() !== month - 1) continue;
      if (d.getUTCDay() === dow) return d;
    }
    throw new Error(`nthWeekday: no last ${dow} in month ${month}/${year}`);
  }
}

export function isHolidayDate(date: Date): boolean {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();

  // Fixed federal holidays
  if (m === 1 && d === 1) return true;   // New Year's Day
  if (m === 7 && d === 4) return true;   // Independence Day
  if (m === 11 && d === 11) return true; // Veterans Day (CA school holiday)
  if (m === 12 && d === 24) return true; // Christmas Eve
  if (m === 12 && d === 25) return true; // Christmas Day
  if (m === 12 && d === 31) return true; // New Year's Eve

  // Floating federal holidays
  const mlk = nthWeekday(y, 1, 1, 3);
  if (m === 1 && d === mlk.getUTCDate()) return true;
  const presidents = nthWeekday(y, 2, 1, 3);
  if (m === 2 && d === presidents.getUTCDate()) return true;
  const memorial = nthWeekday(y, 5, 1, -1);
  if (m === 5 && d === memorial.getUTCDate()) return true;
  const labor = nthWeekday(y, 9, 1, 1);
  if (m === 9 && d === labor.getUTCDate()) return true;
  const columbusDay = nthWeekday(y, 10, 1, 2); // CA school holiday
  if (m === 10 && d === columbusDay.getUTCDate()) return true;
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  if (m === 11 && d === thanksgiving.getUTCDate()) return true;

  // Easter weekend: Good Friday through Easter Monday — Disney's biggest holiday surge
  const easter = easterDate(y);
  const goodFriday = new Date(easter.getTime() - 2 * 86_400_000);
  const easterMonday = new Date(easter.getTime() + 86_400_000);
  const cur = new Date(Date.UTC(y, m - 1, d));
  if (cur >= goodFriday && cur <= easterMonday) return true;

  return false;
}

export function isSchoolBreakDate(date: Date): boolean {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();

  // Winter break — SoCal districts typically Dec 19 – Jan 7
  if (m === 12 && d >= 19) return true;
  if (m === 1 && d <= 7) return true;

  // Spring break — CA district window is wide (Mar 21 – Apr 18 captures all SoCal + most out-of-state)
  if (m === 3 && d >= 21) return true;
  if (m === 4 && d <= 18) return true;

  // Summer — CA schools end mid-June, restart mid-to-late August
  if (m === 6 && d >= 12) return true;
  if (m === 7) return true;
  if (m === 8 && d <= 25) return true;

  // Thanksgiving week: Wed before through Sun after
  const tg = nthWeekday(y, 11, 4, 4);
  const wed = new Date(Date.UTC(tg.getUTCFullYear(), tg.getUTCMonth(), tg.getUTCDate() - 1));
  const sun = new Date(Date.UTC(tg.getUTCFullYear(), tg.getUTCMonth(), tg.getUTCDate() + 3));
  const cur = new Date(Date.UTC(y, m - 1, d));
  if (cur >= wed && cur <= sun) return true;

  return false;
}

// LLMP (Lightning Lane Multi Pass) price ranges reflect Disney's demand tiers.
// Historically $22–$40+; calibrated from observed range.
function llmpCentsToTier(cents: number): number {
  if (cents <= 2500) return 0;
  if (cents <= 2800) return 1;
  if (cents <= 3100) return 2;
  if (cents <= 3500) return 3;
  if (cents <= 3900) return 4;
  return 5;
}

// Disney extends park hours on higher-demand days.
function parkHoursToTier(hours: number): number {
  if (hours <= 12) return 0;
  if (hours <= 13) return 1;
  if (hours <= 14) return 2;
  if (hours <= 15) return 3;
  if (hours <= 16) return 4;
  return 5;
}

type ScheduleEntry = {
  date: string;
  type: string;
  openingTime?: string;
  closingTime?: string;
  purchases?: { id: string; price: { amount: number } }[];
  description?: string;
};

export type DateScheduleInfo = {
  date: string;
  tier: number;
  specialEvent: string | null;
};

export async function fetchDateSchedule(
  startDate: string,
  endDate: string
): Promise<DateScheduleInfo[]> {
  const url = `${THEMEPARKS_API_BASE}/entity/${DISNEYLAND_PARK_ID}/schedule?startDate=${startDate}&endDate=${endDate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ThemeParks.wiki responded ${res.status}`);
  const data: { schedule: ScheduleEntry[] } = await res.json();

  const byDate = new Map<
    string,
    { hours: number | null; llmpCents: number | null; specialEvent: string | null }
  >();

  for (const entry of data.schedule ?? []) {
    if (!byDate.has(entry.date)) {
      byDate.set(entry.date, { hours: null, llmpCents: null, specialEvent: null });
    }
    const info = byDate.get(entry.date)!;

    if (entry.type === "OPERATING" && entry.openingTime && entry.closingTime) {
      info.hours =
        (new Date(entry.closingTime).getTime() - new Date(entry.openingTime).getTime()) /
        3_600_000;
      for (const p of entry.purchases ?? []) {
        if (p.id === "lightninglanemultipass_330339") {
          info.llmpCents = p.price.amount;
        }
      }
    }
    if (entry.type === "TICKETED_EVENT" && entry.description) {
      info.specialEvent = entry.description;
    }
  }

  return Array.from(byDate.entries()).map(([date, info]) => ({
    date,
    tier:
      info.llmpCents !== null
        ? llmpCentsToTier(info.llmpCents)
        : info.hours !== null
          ? parkHoursToTier(info.hours)
          : 2,
    specialEvent: info.specialEvent,
  }));
}

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

  // Fetch weather for up to 16-day Open-Meteo window; beyond that use climatological normals.
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

/**
 * Call Groq adjuster for DateContext rows that have no groqAdjustment yet.
 * Queries DailyForecast for the avg crowd score per date; falls back to 50.
 * Non-fatal: a Groq failure for one date does not abort the others.
 */
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

  // Compute avg crowd score per date from DailyForecast
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
