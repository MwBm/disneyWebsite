import { NextRequest, NextResponse } from "next/server";
import { isValid, parseISO } from "date-fns";
import { z } from "zod";
import {
  getHistoricalRideForecastHoursForDate,
  getRideForecastHoursForDate,
} from "@/lib/forecast-queries";
import { cachedJson } from "@/lib/http";
import { rateLimitResponse } from "@/lib/rate-limit";

/** Hourly forecast points for the selected ride and park date. */
const CACHE_SECONDS = 1800;
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

const ParamsSchema = z.object({
  rideId: z.coerce.number().int().positive(),
});

const QuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => isValid(parseISO(value)), { message: "Invalid date" }),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ rideId: string }> }
) {
  const limited = rateLimitResponse(req, RATE_LIMIT);
  if (limited) return limited;

  const parsedParams = ParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid ride id" }, { status: 400 });
  }

  const parsedQuery = QuerySchema.safeParse({
    date: req.nextUrl.searchParams.get("date"),
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: parsedQuery.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { rideId } = parsedParams.data;
  const { date } = parsedQuery.data;
  const mlRows = await getRideForecastHoursForDate(date, rideId);
  if (mlRows.length > 0) {
    return cachedJson({ rideId, date, source: "ml", rows: mlRows }, CACHE_SECONDS);
  }

  const historicalRows = await getHistoricalRideForecastHoursForDate(date, rideId);
  return cachedJson(
    {
      rideId,
      date,
      source: historicalRows.length > 0 ? "historical" : "unavailable",
      rows: historicalRows,
    },
    CACHE_SECONDS
  );
}
