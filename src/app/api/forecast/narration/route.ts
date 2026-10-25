import { NextRequest, NextResponse } from "next/server";
import { isValid, parseISO } from "date-fns";
import { z } from "zod";
import { deriveCrowdScore, HISTORICAL_FALLBACK_CONFIDENCE } from "@/lib/crowd";
import { getCrowdScoreForDate } from "@/lib/forecast";
import {
  getHistoricalRideWaitsForDate,
  getRideForecastsForDate,
  type RideDayForecast,
} from "@/lib/forecast-queries";
import { narrateForecast } from "@/lib/groq";
import { cachedJson } from "@/lib/http";
import { rateLimitResponse } from "@/lib/rate-limit";
import { DISNEYLAND_PARK_ID, isParkId, type ParkId } from "@/lib/parks";

const CACHE_SECONDS = 1800;
const RATE_LIMIT = { limit: 10, windowMs: 60_000 };

const QuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => isValid(parseISO(value))),
  park: z.coerce.number().int().refine(isParkId, { message: "Invalid park" }),
});

/**
 * Optional, on-demand planning copy. Numeric forecasts never wait for this
 * route, so a slow LLM cannot slow the calendar or the main forecast response.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, RATE_LIMIT);
  if (limited) return limited;

  const parsed = QuerySchema.safeParse({
    date: req.nextUrl.searchParams.get("date"),
    park: req.nextUrl.searchParams.get("park") ?? String(DISNEYLAND_PARK_ID),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { date } = parsed.data;
  const parkId = parsed.data.park as ParkId;
  const [mlForecasts, mlCrowdScore] = await Promise.all([
    getRideForecastsForDate(date, parkId),
    getCrowdScoreForDate(date, parkId),
  ]);

  let forecasts = mlForecasts;
  let crowdScore = mlCrowdScore;
  if (forecasts.length === 0) {
    const historical = await getHistoricalRideWaitsForDate(date, parkId);
    forecasts = historical.map((ride): RideDayForecast => ({
      ...ride,
      mlConfidence: HISTORICAL_FALLBACK_CONFIDENCE,
    }));
    crowdScore = forecasts.length
      ? deriveCrowdScore(forecasts.reduce((sum, ride) => sum + ride.avgWait, 0) / forecasts.length)
      : null;
  }

  if (crowdScore === null || forecasts.length === 0) {
    return cachedJson({ date, parkId, narration: null }, CACHE_SECONDS);
  }

  try {
    const narration = await narrateForecast(crowdScore, forecasts, parseISO(date));
    return cachedJson({ date, parkId, narration }, CACHE_SECONDS);
  } catch (error) {
    console.error("Optional forecast narration failed", error);
    return cachedJson({ date, parkId, narration: null }, CACHE_SECONDS);
  }
}
