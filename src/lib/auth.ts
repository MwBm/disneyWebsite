import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Shared bearer-token guard for privileged routes (cron + admin).
 *
 * Fails closed: a missing or empty CRON_SECRET returns 500. Comparing against
 * `Bearer ${process.env.CRON_SECRET}` directly would accept the literal header
 * "Bearer undefined" whenever the env var is unset.
 */

/** Length-safe, constant-time string compare. */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");

  // timingSafeEqual throws on length mismatch, and the throw itself leaks
  // length. Compare the buffer against itself to burn equivalent time, then
  // report failure.
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Returns a NextResponse to short-circuit with, or null when the request is
 * authorized. Callers must check for null explicitly:
 *
 *   const denied = requireBearer(req);
 *   if (denied) return denied;
 */
export function requireBearer(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "Server misconfigured: CRON_SECRET is not set" },
      { status: 500 }
    );
  }

  const header = req.headers.get("authorization");
  if (!header || !safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
