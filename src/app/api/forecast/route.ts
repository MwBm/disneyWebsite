import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getForecastForDate, getCrowdScoreForDate, getRecentCollectRuns } from "@/lib/forecast";
import { narrateForecast } from "@/lib/claude";
import { parseISO, isValid } from "date-fns";

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
  const [forecasts, crowdScore, recentRuns] = await Promise.all([
    getForecastForDate(date),
    getCrowdScoreForDate(date),
    getRecentCollectRuns(3),
  ]);

  const dataQualityOk = recentRuns.length > 0 && recentRuns.some((r) => r.success);

  // If no ML forecasts exist yet, return cached empty state
  if (forecasts.length === 0) {
    return NextResponse.json({
      date: parsed.data.date,
      crowdScore: null,
      crowdNarration: null,
      forecasts: [],
      source: "none",
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
