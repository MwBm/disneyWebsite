import { NextRequest, NextResponse } from "next/server";
import { syncDateContext, syncGroqAdjustments } from "@/lib/date-context";
import { requireBearer } from "@/lib/auth";
import { ML_FORECAST_DAYS } from "@/lib/forecast";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireBearer(req);
  if (denied) return denied;

  try {
    const syncResult = await syncDateContext(365);
    // The adjustment job depends on DateContext, so it runs after the context
    // refresh. It only covers the serving ML window; dates beyond it have no
    // ML score for an adjustment to modify.
    const adjustmentResult = await syncGroqAdjustments(ML_FORECAST_DAYS);
    return NextResponse.json({ ok: true, ...syncResult, ...adjustmentResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
