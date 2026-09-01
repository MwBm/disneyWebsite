import { prisma } from "@/lib/db";
import { cachedJson } from "@/lib/http";

/**
 * Dynamic, not prerendered.
 *
 * This route takes no search params, so Next prerendered it at build time —
 * which ran this query against the production database during `next build` and
 * made a live DB a hard build dependency. A deploy (or any CI) without database
 * reachability failed with ECONNREFUSED before it could finish.
 *
 * It also baked a 30-day accuracy window into the build output. The window
 * moves every day, so the correct shape is a dynamic route with a CDN cache
 * header, matching /api/forecast and /api/calendar.
 */
export const dynamic = "force-dynamic";

const CACHE_SECONDS = 1800;

const DCA_LANDS = new Set([
  "Avengers Campus",
  "Cars Land",
  "Grizzly Peak",
  "Hollywood Land",
  "Paradise Gardens Park",
  "Pixar Pier",
  "San Fransokyo Square",
]);

function getParkName(landName: string): "Disneyland" | "Disney California Adventure" {
  return DCA_LANDS.has(landName) ? "Disney California Adventure" : "Disneyland";
}

type AccuracyRow = {
  rideId: number;
  rideName: string;
  landName: string;
  predictedFor: Date;
  predictedWait: number;
  actualWait: number;
  absError: number;
};

export async function GET() {
  // DailyForecast.forecastFor and WaitTimeRecord.windowedAt are both stored as
  // 30-min-aligned UTC datetimes, so exact equality join is correct.
  const rows = await prisma.$queryRaw<AccuracyRow[]>`
    SELECT
      df."rideId",
      df."rideName",
      df."landName",
      df."forecastFor"  AS "predictedFor",
      df."predictedWait",
      w."waitTime"      AS "actualWait",
      ABS(df."predictedWait" - w."waitTime") AS "absError"
    FROM "DailyForecast" df
    JOIN "WaitTimeRecord" w
      ON  w."rideId"     = df."rideId"
      AND w."windowedAt" = df."forecastFor"
      AND w."isOpen"     = true
    WHERE df."forecastFor" >= NOW() - INTERVAL '30 days'
      AND df."forecastFor" < NOW()
    ORDER BY df."forecastFor" DESC
  `;

  if (rows.length === 0) {
    return cachedJson({ summary: null, perRide: [], rows: [] }, CACHE_SECONDS);
  }

  // Summary stats
  const errors = rows.map((r) => Number(r.absError));
  const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
  const within5 = errors.filter((e) => e <= 5).length / errors.length;
  const within10 = errors.filter((e) => e <= 10).length / errors.length;
  const within15 = errors.filter((e) => e <= 15).length / errors.length;

  // Per-ride breakdown
  const rideMap: Record<
    number,
    { rideName: string; landName: string; parkName: string; errors: number[] }
  > = {};
  for (const row of rows) {
    const id = Number(row.rideId);
    if (!rideMap[id]) {
      rideMap[id] = {
        rideName: row.rideName,
        landName: row.landName,
        parkName: getParkName(row.landName),
        errors: [],
      };
    }
    rideMap[id].errors.push(Number(row.absError));
  }
  const perRide = Object.entries(rideMap)
    .map(([id, v]) => ({
      rideId: Number(id),
      rideName: v.rideName,
      landName: v.landName,
      parkName: v.parkName,
      mae: v.errors.reduce((a, b) => a + b, 0) / v.errors.length,
      within10:
        v.errors.filter((e) => e <= 10).length / v.errors.length,
      sampleCount: v.errors.length,
    }))
    .sort((a, b) => a.mae - b.mae);

  const serializedRows = rows.map((r) => ({
    rideId: Number(r.rideId),
    rideName: r.rideName,
    predictedFor: r.predictedFor instanceof Date
      ? r.predictedFor.toISOString()
      : String(r.predictedFor),
    predictedWait: Number(r.predictedWait),
    actualWait: Number(r.actualWait),
    absError: Number(r.absError),
  }));

  return cachedJson({
    summary: { mae, within5, within10, within15, totalPredictions: rows.length },
    perRide,
    rows: serializedRows,
  }, CACHE_SECONDS);
}
