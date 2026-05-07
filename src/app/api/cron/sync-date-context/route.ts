import { NextRequest, NextResponse } from "next/server";
import { syncDateContext, syncGroqAdjustments } from "@/lib/date-context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const syncResult = await syncDateContext(365);
    // Non-fatal: Groq adjustment failure doesn't fail the whole sync
    let groqResult = { adjusted: 0 };
    try {
      groqResult = await syncGroqAdjustments(365);
    } catch { /* non-fatal */ }
    return NextResponse.json({ ok: true, ...syncResult, ...groqResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
