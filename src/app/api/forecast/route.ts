import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getForecastForDate, getRecentCollectRuns, getHistoricalMeansForDate } from "@/lib/forecast";
import { narrateForecast, narrateForecastNoDataWithScore } from "@/lib/groq";
import { deriveCrowdScore, HISTORICAL_FALLBACK_CONFIDENCE } from "@/lib/crowd";
import { parseISO, isValid } from "date-fns";
import { parkDateRangeUtc } from "@/lib/park-time";

export const revalidate = 1800;

const QuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => isValid(parseISO(v)), { message: "Invalid date" }),
});

export async function GET(req: NextRequest) {
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
  const [forecasts, recentRuns] = await Promise.all([
    getForecastForDate(dateKey),
    getRecentCollectRuns(3),
  ]);

  const crowdScore =
    forecasts.length > 0
      ? Math.round(forecasts.reduce((a, b) => a + b.crowdScore, 0) / forecasts.length)
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

      return NextResponse.json({
        date: parsed.data.date,
        crowdScore: syntheticCrowdScore,
        crowdNarration,
        forecasts: syntheticForecasts,
        source: "historical",
        dataQualityOk,
        lastCollectedAt,
      });
    }

    // No data at all — Groq general estimate (score + narration in one call)
    let crowdNarration: string | null = null;
    let crowdScore: number | null = null;
    try {
      const groqResult = await narrateForecastNoDataWithScore(date);
      crowdScore = groqResult.score;
      crowdNarration = groqResult.narration;
    } catch { /* non-fatal */ }

    return NextResponse.json({
      date: parsed.data.date,
      crowdScore,
      crowdNarration,
      forecasts: [],
      source: "groq",
      dataQualityOk,
      lastCollectedAt,
    });
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

  return NextResponse.json({
    date: parsed.data.date,
    crowdScore,
    crowdNarration,
    forecasts: mappedForecasts,
    source: "ml",
    dataQualityOk,
    lastCollectedAt,
  });
}
