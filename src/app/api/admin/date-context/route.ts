import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const days = Math.min(Number(searchParams.get("days") ?? 90), 365);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + days * 86_400_000);

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
