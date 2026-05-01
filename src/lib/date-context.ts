import { prisma } from "./db";

const DISNEYLAND_PARK_ID = "7340550b-c14d-4def-80bb-acdb51d49a66";
const THEMEPARKS_API_BASE = "https://api.themeparks.wiki/v1";

// All date arithmetic uses UTC so results are timezone-independent.
// DateContext dates are stored as midnight UTC; getDate()/getMonth() would
// return the previous calendar day in negative-offset timezones.
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
  if (m === 1 && d === 1) return true;   // New Year's Day
  if (m === 7 && d === 4) return true;   // Independence Day
  if (m === 12 && d === 24) return true; // Christmas Eve
  if (m === 12 && d === 25) return true; // Christmas Day
  if (m === 12 && d === 31) return true; // New Year's Eve
  const mlk = nthWeekday(y, 1, 1, 3);
  if (m === 1 && d === mlk.getUTCDate()) return true;
  const presidents = nthWeekday(y, 2, 1, 3);
  if (m === 2 && d === presidents.getUTCDate()) return true;
  const memorial = nthWeekday(y, 5, 1, -1);
  if (m === 5 && d === memorial.getUTCDate()) return true;
  const labor = nthWeekday(y, 9, 1, 1);
  if (m === 9 && d === labor.getUTCDate()) return true;
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  if (m === 11 && d === thanksgiving.getUTCDate()) return true;
  return false;
}

export function isSchoolBreakDate(date: Date): boolean {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (m === 12 && d >= 22) return true; // winter break
  if (m === 1 && d <= 5) return true;
  if (m === 3 && d >= 22) return true;  // spring break
  if (m === 4 && d <= 6) return true;
  if (m === 6 && d >= 15) return true;  // summer
  if (m === 7) return true;
  if (m === 8 && d <= 20) return true;
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

  const fetchedAt = new Date();
  await Promise.all(
    toSync.map((s) => {
      const d = new Date(s.date);
      const isHoliday = isHolidayDate(d);
      const isSchoolBreak = isSchoolBreakDate(d);
      return prisma.dateContext.upsert({
        where: { date: d },
        update: { tier: s.tier, specialEvent: s.specialEvent, isHoliday, isSchoolBreak, tierFetchedAt: fetchedAt, tierSource: "themeparks-wiki" },
        create: { date: d, tier: s.tier, specialEvent: s.specialEvent, isHoliday, isSchoolBreak, tierFetchedAt: fetchedAt, tierSource: "themeparks-wiki" },
      });
    })
  );

  return { synced: toSync.length, skipped: freshDates.size };
}
