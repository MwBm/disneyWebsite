import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCrowdScoresForMonth } from "@/lib/forecast";
import { rateLimitResponse } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/http";
import { DISNEYLAND_PARK_ID, isParkId, type ParkId } from "@/lib/parks";

/** Seconds the CDN may serve a cached month. */
const CACHE_SECONDS = 3600;

/** Backstop against caller-selected cache-key enumeration. */
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

const QuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2030),
  month: z.coerce.number().int().min(1).max(12),
  park: z.coerce.number().int().refine(isParkId, { message: "Invalid park" }),
});

export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, RATE_LIMIT);
  if (limited) return limited;

  const { searchParams } = req.nextUrl;
  const parsed = QuerySchema.safeParse({
    year: searchParams.get("year"),
    month: searchParams.get("month"),
    park: searchParams.get("park") ?? String(DISNEYLAND_PARK_ID),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { year, month } = parsed.data;
  const parkId = parsed.data.park as ParkId;
  const days = await getCrowdScoresForMonth(year, month, parkId);
  return cachedJson({ year, month, parkId, days }, CACHE_SECONDS);
}
