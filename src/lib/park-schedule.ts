import { DCA_PARK_ID, DISNEYLAND_PARK_ID, type ParkId } from "./parks";

const THEMEPARKS_WIKI_PARK_IDS = {
  [DISNEYLAND_PARK_ID]: "7340550b-c14d-4def-80bb-acdb51d49a66",
  [DCA_PARK_ID]: "832fcd51-ea19-4e77-85c7-75d5843b127c",
} satisfies Record<ParkId, string>;
const THEMEPARKS_API_BASE = "https://api.themeparks.wiki/v1";

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

export type ParkDateScheduleInfo = DateScheduleInfo & { parkId: ParkId };

async function fetchScheduleForPark(
  parkId: ParkId,
  startDate: string,
  endDate: string
): Promise<DateScheduleInfo[]> {
  const url = `${THEMEPARKS_API_BASE}/entity/${THEMEPARKS_WIKI_PARK_IDS[parkId]}/schedule?startDate=${startDate}&endDate=${endDate}`;
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

/** Disneyland schedule retained as the simple public helper used by callers/tests. */
export function fetchDateSchedule(startDate: string, endDate: string): Promise<DateScheduleInfo[]> {
  return fetchScheduleForPark(DISNEYLAND_PARK_ID, startDate, endDate);
}

/** Both parks' independently published hours, prices and ticketed events. */
export async function fetchParkDateSchedules(
  startDate: string,
  endDate: string,
): Promise<ParkDateScheduleInfo[]> {
  const entries = await Promise.all(
    ([DISNEYLAND_PARK_ID, DCA_PARK_ID] as const).map(async (parkId) =>
      (await fetchScheduleForPark(parkId, startDate, endDate)).map((entry) => ({ ...entry, parkId }))
    )
  );
  return entries.flat();
}
