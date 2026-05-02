import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const hoursParam = req.nextUrl.searchParams.get("hours");
  const hours = Math.min(Math.max(Number(hoursParam) || 2, 1), 24);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await prisma.waitTimeRecord.findMany({
    where: { recordedAt: { gte: since } },
    orderBy: [{ windowedAt: "desc" }, { rideName: "asc" }],
    select: {
      rideId: true,
      rideName: true,
      landName: true,
      waitTime: true,
      isOpen: true,
      windowedAt: true,
      recordedAt: true,
    },
  });

  return NextResponse.json({
    rows: rows.map((r) => ({
      rideId: r.rideId,
      rideName: r.rideName,
      landName: r.landName,
      waitTime: r.waitTime,
      isOpen: r.isOpen,
      windowedAt: r.windowedAt.toISOString(),
      recordedAt: r.recordedAt.toISOString(),
    })),
    since: since.toISOString(),
    count: rows.length,
    hours,
  });
}
