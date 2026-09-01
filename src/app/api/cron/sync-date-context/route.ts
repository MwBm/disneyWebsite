import { NextRequest, NextResponse } from "next/server";
import { syncDateContext, syncGroqAdjustments } from "@/lib/date-context";
import { requireBearer } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireBearer(req);
  if (denied) return denied;

  try {
    const syncResult = await syncDateContext(365);
    // Non-fatal: Groq adjustment failure doesn't fail the whole sync
    let groqResult = { adjusted: 0 };
    try {
      groqResult = await syncGroqAdjustments(365);
    } catch (err) {
      console.error("syncGroqAdjustments failed", err);
    }
    return NextResponse.json({ ok: true, ...syncResult, ...groqResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
