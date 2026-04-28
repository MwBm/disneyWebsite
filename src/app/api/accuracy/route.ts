import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const revalidate = 1800;

type AccuracyRow = {
  rideId: number;
  rideName: string;
  predictedFor: Date;
  predictedWait: number;
  actualWait: number;
  absError: number;
};

export async function GET() {
  const rows = await prisma.$queryRaw<AccuracyRow[]>`
    SELECT
      p."rideId",
      p."rideName",
      p."predictedFor",
      p."predictedWait",
      w."waitTime"     AS "actualWait",
      ABS(p."predictedWait" - w."waitTime") AS "absError"
    FROM "Prediction" p
    JOIN "WaitTimeRecord" w
      ON  w."rideId"     = p."rideId"
      AND w."windowedAt" = date_trunc('30 minutes', p."predictedFor")
      AND w."isOpen"     = true
    WHERE p."predictedFor" >= NOW() - INTERVAL '30 days'
    ORDER BY p."predictedFor" DESC
  `;

  if (rows.length === 0) {
    return NextResponse.json({ summary: null, perRide: [], rows: [] });
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
    { rideName: string; errors: number[] }
  > = {};
  for (const row of rows) {
    const id = Number(row.rideId);
    if (!rideMap[id]) rideMap[id] = { rideName: row.rideName, errors: [] };
    rideMap[id].errors.push(Number(row.absError));
  }
  const perRide = Object.entries(rideMap)
    .map(([id, v]) => ({
      rideId: Number(id),
      rideName: v.rideName,
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

  return NextResponse.json({
    summary: { mae, within5, within10, within15, totalPredictions: rows.length },
    perRide,
    rows: serializedRows,
  });
}
