import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { cachedJson } from "@/lib/http";

/**
 * Predicted-vs-actual points for one ride, for the accuracy chart.
 *
 * Split out of /api/accuracy, which used to return every joined row for the
 * whole 30-day window so the client could filter to one ride and keep the last
 * 48. The filtering and the limit now happen in Postgres.
 */
export const dynamic = "force-dynamic";

const CACHE_SECONDS = 1800;
const WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 500;

const ParamsSchema = z.object({
  rideId: z.coerce.number().int().positive(),
});

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

type Row = {
  predictedFor: Date;
  predictedWait: number;
  actualWait: number;
  absError: number;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ rideId: string }> }
) {
  const parsedParams = ParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid ride id" }, { status: 400 });
  }

  const parsedQuery = QuerySchema.safeParse({
    limit: req.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: parsedQuery.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { rideId } = parsedParams.data;
  const { limit } = parsedQuery.data;

  // Newest first so LIMIT keeps the most recent points, then reversed below so
  // the chart receives them in chronological order.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      df."forecastFor"  AS "predictedFor",
      df."predictedWait",
      w."waitTime"      AS "actualWait",
      ABS(df."predictedWait" - w."waitTime") AS "absError"
    FROM "DailyForecast" df
    JOIN "WaitTimeRecord" w
      ON  w."rideId"     = df."rideId"
      AND w."windowedAt" = df."forecastFor"
      AND w."isOpen"     = true
    WHERE df."rideId" = ${rideId}
      AND df."forecastFor" >= NOW() - (${WINDOW_DAYS} * INTERVAL '1 day')
      AND df."forecastFor" < NOW()
    ORDER BY df."forecastFor" DESC
    LIMIT ${limit}
  `;

  return cachedJson(
    {
      rideId,
      rows: rows
        .map((r) => ({
          predictedFor:
            r.predictedFor instanceof Date
              ? r.predictedFor.toISOString()
              : String(r.predictedFor),
          predictedWait: Number(r.predictedWait),
          actualWait: Number(r.actualWait),
          absError: Number(r.absError),
        }))
        .reverse(),
    },
    CACHE_SECONDS
  );
}
