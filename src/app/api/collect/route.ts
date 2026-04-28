import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchLiveRides, roundToWindow } from "@/lib/queue-times";
import { requestMLForecast } from "@/lib/ml-client";
import { addMinutes, startOfDay, endOfDay } from "date-fns";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.COLLECT_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rowsUpserted = 0;

  try {
    // 1. Fetch live data (all data sourced server-side — caller supplies nothing)
    const rides = await fetchLiveRides();
    const now = new Date();
    const windowedAt = roundToWindow(now);

    // 2. Bulk upsert with deduplication via unique constraint
    const upserts = rides.map((ride) =>
      prisma.waitTimeRecord.upsert({
        where: { rideId_windowedAt: { rideId: ride.id, windowedAt } },
        create: {
          rideId: ride.id,
          rideName: ride.name,
          landName: ride.landName,
          waitTime: ride.waitTime,
          isOpen: ride.isOpen,
          windowedAt,
        },
        update: {
          waitTime: ride.waitTime,
          isOpen: ride.isOpen,
          recordedAt: now,
        },
      })
    );

    await prisma.$transaction(upserts);
    rowsUpserted = rides.length;

    // 3. Log the collect run
    await prisma.collectRun.create({
      data: { rowsUpserted, success: true },
    });

    // 4. Fetch last 90 days of data and send to ML service
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const historical = await prisma.waitTimeRecord.findMany({
      where: { recordedAt: { gte: ninetyDaysAgo } },
      select: {
        rideId: true,
        rideName: true,
        landName: true,
        waitTime: true,
        isOpen: true,
        recordedAt: true,
      },
    });

    const ridePayload = historical.map((r) => ({
      ride_id: r.rideId,
      ride_name: r.rideName,
      land_name: r.landName,
      wait_time: r.waitTime,
      is_open: r.isOpen,
      recorded_at: r.recordedAt.toISOString(),
    }));

    // 5. Request ML forecasts for next 24 hours (48 × 30-min slots)
    const mlResponse = await requestMLForecast(ridePayload, now);

    if (mlResponse) {
      // Build ride lookup for landName
      const rideMeta: Record<number, { rideName: string; landName: string }> = {};
      for (const ride of rides) {
        rideMeta[ride.id] = { rideName: ride.name, landName: ride.landName };
      }

      const forecastRows = [];
      for (let i = 0; i < 48; i++) {
        const slot = addMinutes(startOfDay(now), i * 30);
        if (slot < now) continue;

        for (const forecast of mlResponse.forecasts) {
          const meta = rideMeta[forecast.ride_id];
          if (!meta) continue;
          forecastRows.push({
            rideId: forecast.ride_id,
            rideName: meta.rideName,
            landName: meta.landName,
            forecastFor: slot,
            predictedWait: forecast.predicted_wait,
            crowdScore: mlResponse.crowd_score,
            mlConfidence: forecast.confidence,
          });
        }
      }

      if (forecastRows.length > 0) {
        await prisma.dailyForecast.createMany({ data: forecastRows, skipDuplicates: true });
      }
    } else {
      // ML service down — update CollectRun with note but don't fail
      await prisma.collectRun.updateMany({
        where: { ranAt: { gte: startOfDay(now), lte: endOfDay(now) }, success: true },
        data: { errorMessage: "ML service unavailable; forecasts not updated" },
      });
    }

    return NextResponse.json({ ok: true, rowsUpserted, mlAvailable: !!mlResponse });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.collectRun.create({
      data: { rowsUpserted, success: false, errorMessage: message },
    });
    console.error("collect error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
