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

  if (m === 1 && d === 1) return true;   // New Year's Day
  if (m === 7 && d === 4) return true;   // Independence Day
  if (m === 11 && d === 11) return true; // Veterans Day (CA school holiday)
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
  const columbusDay = nthWeekday(y, 10, 1, 2);
  if (m === 10 && d === columbusDay.getUTCDate()) return true;
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  if (m === 11 && d === thanksgiving.getUTCDate()) return true;

  // Easter weekend: Good Friday through Easter Monday
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

  // Spring break — CA district window Mar 21 – Apr 18
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
