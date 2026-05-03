export const PARK_TIME_ZONE = "America/Los_Angeles";

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const pacificFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PARK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseParkDateKey(dateKey: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Invalid park date key: ${dateKey}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function partsInParkTime(date: Date): DateParts {
  const parts = pacificFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new Error(`Missing ${type} in park time format`);
    return Number(value);
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function parkOffsetMs(date: Date): number {
  const parts = partsInParkTime(date);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return localAsUtc - (date.getTime() - date.getMilliseconds());
}

function parkDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 2; i++) {
    utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - parkOffsetMs(new Date(utcMs));
  }
  return new Date(utcMs);
}

export function parkDateKey(date: Date): string {
  const { year, month, day } = partsInParkTime(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function normalizeParkDateKey(date: Date | string): string {
  return typeof date === "string" ? date : parkDateKey(date);
}

export function parkDateDow(date: Date | string): number {
  const { year, month, day } = parseParkDateKey(normalizeParkDateKey(date));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function parkDateRangeUtc(date: Date | string): { start: Date; endExclusive: Date } {
  const { year, month, day } = parseParkDateKey(normalizeParkDateKey(date));
  return {
    start: parkDateTimeToUtc(year, month, day),
    endExclusive: parkDateTimeToUtc(year, month, day + 1),
  };
}

export function parkMonthRangeUtc(year: number, month: number): { start: Date; endExclusive: Date } {
  return {
    start: parkDateTimeToUtc(year, month, 1),
    endExclusive: parkDateTimeToUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1),
  };
}

export function dateContextMonthRangeUtc(year: number, month: number): { start: Date; endExclusive: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    endExclusive: new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1)),
  };
}
