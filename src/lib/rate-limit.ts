/**
 * Sliding-window rate limiter, in-process.
 *
 * Deliberately NOT distributed. On Vercel each serverless instance keeps its
 * own counters, so the effective global limit is (limit × warm instances) and
 * counters reset on cold start. That is a real weakness — but the alternative
 * for this project was an unmetered public LLM proxy, and a best-effort ceiling
 * beats none. If this ever needs to be exact, swap the Map for Redis; the
 * `checkRateLimit` signature is the seam.
 */

import { NextResponse } from "next/server";

export type RateLimitConfig = {
  /** Max requests allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the oldest hit in the window expires. 0 when allowed. */
  retryAfterSeconds: number;
};

/** key -> ascending timestamps (ms) of hits still inside the window. */
const hits = new Map<string, number[]>();

/**
 * Hard ceiling on tracked keys so a flood of unique IPs can't grow the map
 * without bound. When exceeded we drop the least-recently-active keys, which
 * is safe: a dropped key simply gets a fresh window.
 */
const MAX_TRACKED_KEYS = 10_000;

function evictOldestKeys(): void {
  const overflow = hits.size - MAX_TRACKED_KEYS;
  if (overflow <= 0) return;

  // Map preserves insertion order, but a key's position goes stale as it is
  // re-hit, so sort by last-seen timestamp rather than trusting that order.
  const byLastSeen = [...hits.entries()].sort(
    (a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0)
  );
  for (let i = 0; i < overflow; i++) hits.delete(byLastSeen[i][0]);
}

export function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitConfig,
  now: number = Date.now()
): RateLimitResult {
  const cutoff = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= limit) {
    // recent is ascending, so [0] is the hit that expires soonest.
    const retryAfterMs = recent[0] + windowMs - now;
    hits.set(key, recent);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);
  evictOldestKeys();

  return { allowed: true, remaining: limit - recent.length, retryAfterSeconds: 0 };
}

/**
 * Best-effort client identity. `x-forwarded-for` is client-controlled in
 * general; on Vercel the platform overwrites it, so the leftmost entry is
 * trustworthy there. Falls back to a shared bucket rather than to a spoofable
 * per-request value — a shared bucket over-limits, a spoofable one never limits.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}

/** Test-only: drop all tracked state. */
export function _resetRateLimits(): void {
  hits.clear();
}

/** The 429 response for a client over `config`, or null when the request may proceed. */
export function rateLimitResponse(req: Request, config: RateLimitConfig): NextResponse | null {
  const result = checkRateLimit(clientKey(req), config);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Please slow down." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}
