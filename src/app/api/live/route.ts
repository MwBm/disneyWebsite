import { NextResponse } from "next/server";
import { fetchLiveRides } from "@/lib/queue-times";

export const revalidate = 300;

export async function GET() {
  try {
    const rides = await fetchLiveRides();
    return NextResponse.json({ rides, fetchedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch live data";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
