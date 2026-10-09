import { NextRequest, NextResponse } from "next/server";
import { fetchWeatherForecast, FORECAST_HORIZON_DAYS } from "@/lib/weather";
import { rateLimitResponse } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/http";
import { addParkDays, parkDateKey } from "@/lib/park-time";

/**
 * The calendar's 16-day weather strip.
 *
 * Takes no parameters on purpose: one URL means one CDN cache entry serving
 * every visitor, and no way to enumerate ranges to force upstream calls.
 */
const CACHE_SECONDS = 3600;
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, RATE_LIMIT);
  if (limited) return limited;

  const start = parkDateKey(new Date());
  const end = addParkDays(start, FORECAST_HORIZON_DAYS - 1);

  try {
    const map = await fetchWeatherForecast(start, end);
    return cachedJson({ days: [...map.values()] }, CACHE_SECONDS);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch weather";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
