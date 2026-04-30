import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCrowdScoresForMonth } from "@/lib/forecast";
import { estimateDowCrowdScores } from "@/lib/groq";
import { prisma } from "@/lib/db";

export const revalidate = 3600;

const QuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2030),
  month: z.coerce.number().int().min(1).max(12),
});

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const parsed = QuerySchema.safeParse({
    year: searchParams.get("year"),
    month: searchParams.get("month"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { year, month } = parsed.data;
  const days = await getCrowdScoresForMonth(year, month);

  const hasMissingDays = days.some((d) => d.source === null);
  if (hasMissingDays) {
    let groqDow: Map<number, number> = new Map();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cached = await prisma.dateContext.findFirst({
      where: { groqDowEstimate: { not: Prisma.JsonNull }, date: { gte: sevenDaysAgo } },
      orderBy: { date: "desc" },
      select: { groqDowEstimate: true },
    });

    if (cached?.groqDowEstimate) {
      const raw = cached.groqDowEstimate as Record<string, number>;
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "number") groqDow.set(Number(k), v);
      }
    } else {
      try {
        groqDow = await estimateDowCrowdScores();
        if (groqDow.size > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          await prisma.dateContext.upsert({
            where: { date: today },
            update: { groqDowEstimate: Object.fromEntries(groqDow) },
            create: { date: today, groqDowEstimate: Object.fromEntries(groqDow) },
          });
        }
      } catch {
        // non-fatal — days stay null
      }
    }

    const filledDays = days.map((day) => {
      if (day.source !== null || groqDow.size === 0) return day;
      const [y, m, d] = day.date.split("-").map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      const score = groqDow.get(dow);
      return score !== undefined ? { ...day, crowdScore: score, source: "groq" as const } : day;
    });
    return NextResponse.json({ year, month, days: filledDays });
  }

  return NextResponse.json({ year, month, days });
}
