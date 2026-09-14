import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCrowdScoreForDate } from "@/lib/forecast";
import {
  getHistoricalRideWaitsForDate,
  getRecentCollectRuns,
  getRideForecastsForDate,
  type RideDayForecast,
} from "@/lib/forecast-queries";
import { narrateForecast, narrateForecastNoDataWithScore } from "@/lib/groq";
import { deriveCrowdScore, HISTORICAL_FALLBACK_CONFIDENCE } from "@/lib/crowd";
import { parseISO, isValid } from "date-fns";
import { parkDateRangeUtc } from "@/lib/park-time";
import { prisma } from "@/lib/db";
import { rateLimitResponse } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/http";

/** Seconds the CDN may serve a cached forecast for a given date. */
const CACHE_SECONDS = 1800;

/**
 * Every cache miss here can cost a Groq call, and the date is caller-supplied,
 * so enumerating dates bypasses the cache entirely. The limit is the backstop.
 */
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

const QuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => isValid(parseISO(v)), { message: "Invalid date" }),
});

/**
 * `forecasts` holds one entry per ride with its average and peak wait for the
 * day, whichever source produced it. Both paths used to return something else:
 * the ML path one arbitrary time slot per ride, the historical path one row
 * per ride per hour.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, RATE_LIMIT);
  if (limited) return limited;

  const { searchParams } = req.nextUrl;
  const parsed = QuerySchema.safeParse({ date: searchParams.get("date") });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const dateKey = parsed.data.date;
  const date = parkDateRangeUtc(dateKey).start;
  const [rides, mlCrowdScore, recentRuns, dateCtx] = await Promise.all([
    getRideForecastsForDate(dateKey),
    getCrowdScoreForDate(dateKey),
    getRecentCollectRuns(3),
    prisma.dateContext.findUnique({
      where: { date },
      select: { groqAdjustment: true, groqReasoning: true },
    }),
  ]);

  const dataQualityOk = recentRuns.length > 0 && recentRuns.some((r) => r.success);
  const lastCollectedAt = recentRuns[0]?.ranAt ?? null;
  const status = { date: dateKey, dataQualityOk, lastCollectedAt };

  if (rides.length > 0) {
    const groqAdjustment = dateCtx?.groqAdjustment ?? 0;
    const crowdScore =
      mlCrowdScore !== null
        ? Math.min(100, Math.max(0, Math.round(mlCrowdScore + groqAdjustment)))
        : null;

    return cachedJson({
      ...status,
      crowdScore,
      groqAdjustment: groqAdjustment !== 0 ? groqAdjustment : undefined,
      groqReasoning: dateCtx?.groqReasoning ?? undefined,
      crowdNarration: crowdScore !== null ? await narrate("ml path", crowdScore, rides, date) : null,
      forecasts: rides,
      source: "ml",
    }, CACHE_SECONDS);
  }

  const historical = await getHistoricalRideWaitsForDate(dateKey);
  if (historical.length > 0) {
    const forecasts: RideDayForecast[] = historical.map((r) => ({
      ...r,
      mlConfidence: HISTORICAL_FALLBACK_CONFIDENCE,
    }));
    const meanAvgWait = forecasts.reduce((sum, r) => sum + r.avgWait, 0) / forecasts.length;
    const crowdScore = deriveCrowdScore(meanAvgWait);

    return cachedJson({
      ...status,
      crowdScore,
      crowdNarration: await narrate("historical path", crowdScore, forecasts, date),
      forecasts,
      source: "historical",
    }, CACHE_SECONDS);
  }

  // No data at all — Groq general estimate (score + narration in one call)
  let crowdNarration: string | null = null;
  let crowdScore: number | null = null;
  try {
    const groqResult = await narrateForecastNoDataWithScore(date);
    crowdScore = groqResult.score;
    crowdNarration = groqResult.narration;
  } catch (err) {
    console.error("narrateForecastNoDataWithScore failed", err);
  }

  return cachedJson({
    ...status,
    crowdScore,
    crowdNarration,
    forecasts: [],
    source: "groq",
  }, CACHE_SECONDS);
}

/**
 * Narration is a nice-to-have: the forecast is returned without it, but a
 * failure is logged, never swallowed. A bare catch once hid every narration
 * call 404ing on a retired Groq model.
 */
async function narrate(
  path: string,
  crowdScore: number,
  rides: RideDayForecast[],
  date: Date
): Promise<string | null> {
  try {
    return await narrateForecast(crowdScore, rides, date);
  } catch (err) {
    console.error(`narrateForecast failed (${path})`, err);
    return null;
  }
}
