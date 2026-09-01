import { NextRequest, NextResponse } from "next/server";
import { fetchWeatherForecast, FORECAST_HORIZON_DAYS } from "@/lib/weather";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/http";

/**
 * The calendar's 16-day weather strip.
 *
 * Takes no parameters on purpose: one URL means one CDN cache entry serving
 * every visitor, and no way to enumerate ranges to force upstream calls. The
 * calendar previously called Open-Meteo from each visitor's browser.
 */
const CACHE_SECONDS = 3600;
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const limit = checkRateLimit(clientKey(req), RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const start = new Date();
  const end = new Date(start.getTime() + (FORECAST_HORIZON_DAYS - 1) * 86_400_000);

  try {
    const map = await fetchWeatherForecast(isoDate(start), isoDate(end));
    return cachedJson({ days: [...map.values()] }, CACHE_SECONDS);
  } catch (err) {
    // Surfaced rather than swallowed: the client used to .catch(() => {}) this
    // into a permanently empty map with nothing shown to the user.
    const message = err instanceof Error ? err.message : "Failed to fetch weather";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
