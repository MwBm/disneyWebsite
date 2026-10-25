import { NextRequest, NextResponse } from "next/server";
import { syncDateContext } from "@/lib/date-context";
import { requireBearer } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireBearer(req);
  if (denied) return denied;

  try {
    const syncResult = await syncDateContext(365);
    return NextResponse.json({ ok: true, ...syncResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
