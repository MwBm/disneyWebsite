import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getForecastForDate, getRecentCollectRuns, getHistoricalMeansForDate } from "@/lib/forecast";
import { narrateForecast, narrateForecastNoData } from "@/lib/groq";
import { deriveCrowdScore, HISTORICAL_FALLBACK_CONFIDENCE } from "@/lib/crowd";
import { parseISO, isValid, startOfDay } from "date-fns";

export const revalidate = 1800;

const QuerySchema = z.object({
  date: z.string().refine((v) => isValid(parseISO(v)), { message: "Invalid date" }),
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

  const date = parseISO(parsed.data.date);
  const [forecasts, recentRuns] = await Promise.all([
    getForecastForDate(date),
    getRecentCollectRuns(3),
  ]);

  const crowdScore =
    forecasts.length > 0
      ? Math.round(forecasts.reduce((a, b) => a + b.crowdScore, 0) / forecasts.length)
      : null;

  const dataQualityOk = recentRuns.length > 0 && recentRuns.some((r) => r.success);

  if (forecasts.length === 0) {
    const historicalMeans = await getHistoricalMeansForDate(date);

    if (historicalMeans.length > 0) {
      const dayStart = startOfDay(date);
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
      });
    }

    // No data at all — Groq general estimate
    let crowdNarration: string | null = null;
    try {
      crowdNarration = await narrateForecastNoData(date);
    } catch { /* non-fatal */ }

    return NextResponse.json({
      date: parsed.data.date,
      crowdScore: null,
      crowdNarration,
      forecasts: [],
      source: "groq",
      dataQualityOk,
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
  });
}
