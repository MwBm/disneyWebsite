import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCrowdScoreForDate } from "@/lib/forecast";
import {
  getHistoricalRideWaitsForDate,
  getRecentCollectRuns,
  getRideForecastsForDate,
  type RideDayForecast,
} from "@/lib/forecast-queries";
import { deriveCrowdScore, HISTORICAL_FALLBACK_CONFIDENCE } from "@/lib/crowd";
import { parseISO, isValid } from "date-fns";
import { rateLimitResponse } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/http";
import { DISNEYLAND_PARK_ID, isParkId, type ParkId } from "@/lib/parks";

/** Seconds the CDN may serve a cached forecast for a given date. */
const CACHE_SECONDS = 1800;

/**
 * The date and park are caller-supplied, so this backstop prevents cache-key
 * enumeration from bypassing the CDN cache.
 */
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

/** Collect runs every 30 minutes; three missed dispatches make data stale. */
const MAX_COLLECT_AGE_MS = 90 * 60_000;

const QuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => isValid(parseISO(v)), { message: "Invalid date" }),
  park: z.coerce.number().int().refine(isParkId, { message: "Invalid park" }),
});

/**
 * `forecasts` holds one entry per ride with its average and peak wait for the
 * day, whichever source produced it.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, RATE_LIMIT);
  if (limited) return limited;

  const { searchParams } = req.nextUrl;
  const parsed = QuerySchema.safeParse({
    date: searchParams.get("date"),
    park: searchParams.get("park") ?? String(DISNEYLAND_PARK_ID),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const dateKey = parsed.data.date;
  const parkId = parsed.data.park as ParkId;
  const [rides, mlCrowdScore, recentRuns] = await Promise.all([
    getRideForecastsForDate(dateKey, parkId),
    getCrowdScoreForDate(dateKey, parkId),
    getRecentCollectRuns(3),
  ]);

  const latestSuccessfulCollection = recentRuns.find((run) => run.success) ?? null;
  const lastCollectedAt = latestSuccessfulCollection?.ranAt ?? null;
  const dataQualityOk =
    lastCollectedAt !== null && Date.now() - lastCollectedAt.getTime() <= MAX_COLLECT_AGE_MS;
  const status = { date: dateKey, parkId, dataQualityOk, lastCollectedAt };

  if (rides.length > 0) {
    return cachedJson({
      ...status,
      crowdScore: mlCrowdScore,
      // Narrative advice is deliberately loaded through the optional endpoint
      // after numeric predictions render; never put an LLM on this read path.
      crowdNarration: null,
      forecasts: rides,
      source: "ml",
    }, CACHE_SECONDS);
  }

  const historical = await getHistoricalRideWaitsForDate(dateKey, parkId);
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
      crowdNarration: null,
      forecasts,
      source: "historical",
    }, CACHE_SECONDS);
  }

  return cachedJson({
    ...status,
    crowdScore: null,
    crowdNarration: null,
    forecasts: [],
    source: "unavailable",
  }, CACHE_SECONDS);
}
