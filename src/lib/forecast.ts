import { prisma } from "./db";
import { deriveCrowdScore } from "./crowd";
import { getDailyMlCrowdScores, getHistoricalDowMeanWaits } from "./forecast-queries";
import {
  dateContextMonthRangeUtc,
  addParkDays,
  dateContextDate,
  normalizeParkDateKey,
  parkDateKey,
  parkDateDow,
  parkDateRangeUtc,
  parkMonthRangeUtc,
} from "./park-time";
import { DISNEYLAND_PARK_ID, type ParkId } from "./parks";

/**
 * Crowd-score logic. The SQL it depends on lives in ./forecast-queries, so
 * unit tests can mock each query separately.
 */

export const ML_FORECAST_DAYS = 30;
export const MAX_GROQ_CROWD_ADJUSTMENT = 35;

/** Add a bounded stored Groq correction to a materialized ML score. */
export function applyGroqCrowdAdjustment(
  mlScore: number | null,
  adjustment: number | null | undefined
): number | null {
  if (mlScore === null || adjustment === null || adjustment === undefined || !Number.isFinite(adjustment)) {
    return mlScore;
  }

  const boundedAdjustment = Math.max(-MAX_GROQ_CROWD_ADJUSTMENT, Math.min(MAX_GROQ_CROWD_ADJUSTMENT, adjustment));
  return Math.round(Math.max(0, Math.min(100, mlScore + boundedAdjustment)));
}

/** ML crowd score plus its stored, bounded Groq correction for one park date. */
export async function getCrowdScoreForDate(
  date: Date | string,
  parkId: ParkId = DISNEYLAND_PARK_ID
): Promise<number | null> {
  const { start, endExclusive } = parkDateRangeUtc(date);
  const scores = await getDailyMlCrowdScores(start, endExclusive, parkId);
  const dateKey = normalizeParkDateKey(date);
  const mlScore = scores.get(dateKey) ?? null;
  if (mlScore === null) return null;

  const context = await prisma.dateContext.findUnique({
    where: { parkId_date: { parkId, date: dateContextDate(dateKey) } },
    select: { groqAdjustment: true },
  });
  return applyGroqCrowdAdjustment(mlScore, context?.groqAdjustment);
}

export type DayCrowdScore = {
  date: string;
  crowdScore: number | null;
  source: "ml" | "historical" | "groq" | "unavailable" | null;
  tier: number | null;
  specialEvent: string | null;
  isHoliday: boolean;
};

export function resolveCrowdScore({
  mlScore,
  historicalScore,
  groqScore,
  isBeyondWindow,
}: {
  mlScore: number | null;
  historicalScore: number | null;
  groqScore: number | null;
  isBeyondWindow: boolean;
}): { crowdScore: number | null; source: DayCrowdScore["source"] } {
  if (mlScore !== null) return { crowdScore: mlScore, source: "ml" };
  if (!isBeyondWindow && historicalScore !== null) return { crowdScore: historicalScore, source: "historical" };
  if (!isBeyondWindow && groqScore !== null) return { crowdScore: groqScore, source: "groq" };
  if (isBeyondWindow) return { crowdScore: null, source: "unavailable" };
  return { crowdScore: null, source: null };
}

export async function getCrowdScoresForMonth(
  year: number,
  month: number,
  parkId: ParkId = DISNEYLAND_PARK_ID
): Promise<DayCrowdScore[]> {
  const { start, endExclusive } = parkMonthRangeUtc(year, month);
  const dateContextRange = dateContextMonthRangeUtc(year, month);

  const [mlScoreByDate, meanWaitByDow, dateContexts] = await Promise.all([
    getDailyMlCrowdScores(start, endExclusive, parkId),
    // Kept as a raw mean wait so each date's own tier can scale it below.
    getHistoricalDowMeanWaits(month, parkId),
    prisma.dateContext.findMany({
      where: {
        parkId,
        date: { gte: dateContextRange.start, lt: dateContextRange.endExclusive },
      },
      select: { date: true, tier: true, specialEvent: true, isHoliday: true, groqAdjustment: true },
    }),
  ]);

  // DateContext.date is midnight UTC standing for the park date, so its UTC
  // calendar date is the key.
  const contextByDate = new Map(dateContexts.map((c) => [c.date.toISOString().slice(0, 10), c]));

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const windowCutoffKey = addParkDays(parkDateKey(new Date()), ML_FORECAST_DAYS);

  const results: DayCrowdScore[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const context = contextByDate.get(key);
    const tier = context?.tier ?? null;

    const rawMlScore = mlScoreByDate.get(key) ?? null;
    const mlScore = applyGroqCrowdAdjustment(rawMlScore, context?.groqAdjustment);
    const dowMeanWait = meanWaitByDow.get(parkDateDow(key)) ?? null;
    const historicalScore = dowMeanWait !== null ? deriveCrowdScore(dowMeanWait, tier ?? undefined) : null;

    const { crowdScore, source } = resolveCrowdScore({
      mlScore,
      historicalScore,
      groqScore: null,
      isBeyondWindow: key > windowCutoffKey,
    });

    results.push({
      date: key,
      crowdScore,
      source,
      tier,
      specialEvent: context?.specialEvent ?? null,
      isHoliday: context?.isHoliday ?? false,
    });
  }
  return results;
}
