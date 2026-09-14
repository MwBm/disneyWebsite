import { NextResponse } from "next/server";
import { fetchLiveRides } from "@/lib/queue-times";
import { cachedJson } from "@/lib/http";

/**
 * `export const revalidate` is inert here: fetchLiveRides uses
 * `next: { revalidate: 0 }`, which makes the route dynamic. The Cache-Control
 * header is what caches it.
 */
const CACHE_SECONDS = 300;

export async function GET() {
  try {
    const rides = await fetchLiveRides();
    return cachedJson({ rides, fetchedAt: new Date().toISOString() }, CACHE_SECONDS);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch live data";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
