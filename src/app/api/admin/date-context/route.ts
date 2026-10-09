import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBearer } from "@/lib/auth";
import { addParkDays, dateContextDate, parkDateKey } from "@/lib/park-time";

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const denied = requireBearer(req);
  if (denied) return denied;

  const { searchParams } = req.nextUrl;
  // Non-numeric input (?days=abc) yields NaN, which propagates through the date
  // arithmetic below and reaches Prisma as an Invalid Date. Clamp explicitly.
  const requestedDays = Number(searchParams.get("days") ?? 90);
  const days = Number.isFinite(requestedDays)
    ? Math.min(Math.max(Math.trunc(requestedDays), 1), 365)
    : 90;
  const startKey = parkDateKey(new Date());
  const start = dateContextDate(startKey);
  const end = dateContextDate(addParkDays(startKey, days));

  const rows = await prisma.dateContext.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
    select: {
      date: true,
      tier: true,
      specialEvent: true,
      isHoliday: true,
      isSchoolBreak: true,
      tierFetchedAt: true,
      tierSource: true,
    },
  });

  return NextResponse.json({ count: rows.length, days, rows });
}
