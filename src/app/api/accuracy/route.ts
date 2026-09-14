import { prisma } from "@/lib/db";
import { cachedJson } from "@/lib/http";
import { getParkName } from "@/lib/parks";

/**
 * Without this, Next prerenders the route at build time: `next build` would
 * need a reachable database, and the moving 30-day window would be frozen into
 * the build output.
 */
export const dynamic = "force-dynamic";

const CACHE_SECONDS = 1800;
const WINDOW_DAYS = 30;

type SummaryRow = {
  mae: number;
  within5: number;
  within10: number;
  within15: number;
  totalPredictions: bigint | number;
};

type PerRideRow = {
  rideId: bigint | number;
  rideName: string;
  landName: string;
  mae: number;
  within10: number;
  sampleCount: bigint | number;
};

/**
 * DailyForecast.forecastFor and WaitTimeRecord.windowedAt are both 30-minute
 * aligned UTC datetimes, so an equality join is exact.
 */
export async function GET() {
  const [summaryRows, perRideRows] = await Promise.all([
    prisma.$queryRaw<SummaryRow[]>`
      SELECT
        AVG(ABS(df."predictedWait" - w."waitTime"))::float                                    AS "mae",
        AVG((ABS(df."predictedWait" - w."waitTime") <= 5)::int)::float                        AS "within5",
        AVG((ABS(df."predictedWait" - w."waitTime") <= 10)::int)::float                       AS "within10",
        AVG((ABS(df."predictedWait" - w."waitTime") <= 15)::int)::float                       AS "within15",
        COUNT(*)                                                                              AS "totalPredictions"
      FROM "DailyForecast" df
      JOIN "WaitTimeRecord" w
        ON  w."rideId"     = df."rideId"
        AND w."windowedAt" = df."forecastFor"
        AND w."isOpen"     = true
      WHERE df."forecastFor" >= NOW() - (${WINDOW_DAYS} * INTERVAL '1 day')
        AND df."forecastFor" < NOW()
    `,
    prisma.$queryRaw<PerRideRow[]>`
      SELECT
        df."rideId",
        MAX(df."rideName")                                                     AS "rideName",
        MAX(df."landName")                                                     AS "landName",
        AVG(ABS(df."predictedWait" - w."waitTime"))::float                     AS "mae",
        AVG((ABS(df."predictedWait" - w."waitTime") <= 10)::int)::float        AS "within10",
        COUNT(*)                                                               AS "sampleCount"
      FROM "DailyForecast" df
      JOIN "WaitTimeRecord" w
        ON  w."rideId"     = df."rideId"
        AND w."windowedAt" = df."forecastFor"
        AND w."isOpen"     = true
      WHERE df."forecastFor" >= NOW() - (${WINDOW_DAYS} * INTERVAL '1 day')
        AND df."forecastFor" < NOW()
      GROUP BY df."rideId"
      ORDER BY AVG(ABS(df."predictedWait" - w."waitTime")) ASC
    `,
  ]);

  const raw = summaryRows[0];
  const total = Number(raw?.totalPredictions ?? 0);

  if (total === 0) {
    return cachedJson({ summary: null, perRide: [] }, CACHE_SECONDS);
  }

  return cachedJson(
    {
      summary: {
        mae: Number(raw.mae),
        within5: Number(raw.within5),
        within10: Number(raw.within10),
        within15: Number(raw.within15),
        totalPredictions: total,
      },
      perRide: perRideRows.map((r) => ({
        rideId: Number(r.rideId),
        rideName: r.rideName,
        landName: r.landName,
        parkName: getParkName(r.landName),
        mae: Number(r.mae),
        within10: Number(r.within10),
        sampleCount: Number(r.sampleCount),
      })),
    },
    CACHE_SECONDS
  );
}
