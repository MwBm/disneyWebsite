import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getForecastForDate, getRecentCollectRuns, getHistoricalMeansForDate } from "@/lib/forecast";
import { narrateForecast, narrateForecastNoDataWithScore } from "@/lib/groq";
import { deriveCrowdScore, HISTORICAL_FALLBACK_CONFIDENCE } from "@/lib/crowd";
import { parseISO, isValid } from "date-fns";
import { parkDateRangeUtc } from "@/lib/park-time";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
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

export async function GET(req: NextRequest) {
  const limit = checkRateLimit(clientKey(req), RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

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
  const [forecasts, recentRuns, dateCtx] = await Promise.all([
    getForecastForDate(dateKey),
    getRecentCollectRuns(3),
    prisma.dateContext.findUnique({
      where: { date },
      select: { groqAdjustment: true, groqReasoning: true },
    }),
  ]);

  const mlCrowdScore =
    forecasts.length > 0
      ? Math.round(forecasts.reduce((a, b) => a + b.crowdScore, 0) / forecasts.length)
      : null;

  const groqAdjustment = dateCtx?.groqAdjustment ?? 0;
  const crowdScore =
    mlCrowdScore !== null
      ? Math.min(100, Math.max(0, Math.round(mlCrowdScore + groqAdjustment)))
      : null;

  const dataQualityOk = recentRuns.length > 0 && recentRuns.some((r) => r.success);
  const lastCollectedAt = recentRuns[0]?.ranAt ?? null;

  if (forecasts.length === 0) {
    const historicalMeans = await getHistoricalMeansForDate(dateKey);

    if (historicalMeans.length > 0) {
      const dayStart = parkDateRangeUtc(dateKey).start;
      const syntheticForecasts = historicalMeans.map((m) => ({
        rideId: m.rideId,
        rideName: m.rideName,
        landName: m.landName,
        forecastFor: new Date(dayStart.getTime() + m.hour * 3_600_000).toISOString(),
        predictedWait: m.meanWait,
        crowdScore: 0,
        mlConfidence: HISTORICAL_FALLBACK_CONFIDENCE,
      }));

      const avgWait =
        syntheticForecasts.reduce((s, f) => s + f.predictedWait, 0) / syntheticForecasts.length;
      const syntheticCrowdScore = deriveCrowdScore(avgWait);
      syntheticForecasts.forEach((f) => (f.crowdScore = syntheticCrowdScore));

      let crowdNarration: string | null = null;
      try {
        crowdNarration = await narrateForecast(syntheticCrowdScore, syntheticForecasts, date);
      } catch { /* non-fatal */ }

      return cachedJson({
        date: parsed.data.date,
        crowdScore: syntheticCrowdScore,
        crowdNarration,
        forecasts: syntheticForecasts,
        source: "historical",
        dataQualityOk,
        lastCollectedAt,
      }, CACHE_SECONDS);
    }

    // No data at all — Groq general estimate (score + narration in one call)
    let crowdNarration: string | null = null;
    let crowdScore: number | null = null;
    try {
      const groqResult = await narrateForecastNoDataWithScore(date);
      crowdScore = groqResult.score;
      crowdNarration = groqResult.narration;
    } catch { /* non-fatal */ }

    return cachedJson({
      date: parsed.data.date,
      crowdScore,
      crowdNarration,
      forecasts: [],
      source: "groq",
      dataQualityOk,
      lastCollectedAt,
    }, CACHE_SECONDS);
  }

  const mappedForecasts = forecasts.map((f) => ({
    rideId: f.rideId,
    rideName: f.rideName,
    landName: f.landName,
    forecastFor: f.forecastFor.toISOString(),
    predictedWait: f.predictedWait,
    crowdScore: f.crowdScore,
    mlConfidence: f.mlConfidence,
  }));

  // Generate Claude narration for the crowd forecast
  let crowdNarration: string | null = null;
  if (crowdScore !== null) {
    try {
      crowdNarration = await narrateForecast(crowdScore, mappedForecasts, date);
    } catch {
      // Non-fatal — Claude narration is a nice-to-have
    }
  }

  return cachedJson({
    date: parsed.data.date,
    crowdScore,
    groqAdjustment: groqAdjustment !== 0 ? groqAdjustment : undefined,
    groqReasoning: dateCtx?.groqReasoning ?? undefined,
    crowdNarration,
    forecasts: mappedForecasts,
    source: "ml",
    dataQualityOk,
    lastCollectedAt,
  }, CACHE_SECONDS);
}
