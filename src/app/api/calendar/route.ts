import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCrowdScoresForMonth } from "@/lib/forecast";
import { estimateDowCrowdScores } from "@/lib/groq";

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
    try {
      groqDow = await estimateDowCrowdScores();
    } catch {
      // non-fatal — days stay null
    }

    for (const day of days) {
      if (day.source === null && groqDow.size > 0) {
        const [y, m, d] = day.date.split("-").map(Number);
        const dow = new Date(y, m - 1, d).getDay();
        const score = groqDow.get(dow);
        if (score !== undefined) {
          day.crowdScore = score;
          day.source = "groq";
        }
      }
    }
  }

  return NextResponse.json({ year, month, days });
}
