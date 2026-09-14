import { NextResponse } from "next/server";

/**
 * Cache headers for a route handler that Next.js serves dynamically.
 *
 * `export const revalidate = N` does nothing in a handler that reads
 * `req.nextUrl.searchParams` — reading them opts the route into dynamic
 * rendering, so the build marks it `ƒ` and the revalidate value is silently
 * ignored.
 *
 * A `Cache-Control` header is not ignored: Vercel's CDN caches the response
 * per full URL (so per date, per month), which is exactly the granularity
 * these routes need.
 */
export function cacheHeaders(sMaxAgeSeconds: number): Record<string, string> {
  return {
    "Cache-Control":
      `public, s-maxage=${sMaxAgeSeconds}, ` +
      `stale-while-revalidate=${sMaxAgeSeconds * 2}`,
  };
}

/** `NextResponse.json` with CDN cache headers attached. */
export function cachedJson(data: unknown, sMaxAgeSeconds: number): NextResponse {
  return NextResponse.json(data, { headers: cacheHeaders(sMaxAgeSeconds) });
}
