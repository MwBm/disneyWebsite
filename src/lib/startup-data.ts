"use client";

import { parkDateKey } from "@/lib/park-time";
import { DCA_PARK_ID, DISNEYLAND_PARK_ID } from "@/lib/parks";

const responses = new Map<string, unknown>();
let preloadPromise: Promise<void> | null = null;

async function preloadJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return undefined;
    const body = await res.json();
    responses.set(url, body);
    return body;
  } catch {
    // A warm cache is an enhancement. Individual pages retain their normal
    // error handling if a startup request cannot be completed.
    return undefined;
  }
}

/** Starts the one-time initial data warmup shared by every client page. */
export function preloadStartupData(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  if (typeof window === "undefined") return Promise.resolve();

  const today = parkDateKey(new Date());
  const [year, month] = today.split("-").map(Number);
  const forecastUrls = [DISNEYLAND_PARK_ID, DCA_PARK_ID].map(
    (parkId) => `/api/forecast?date=${today}&park=${parkId}`
  );
  const calendarUrls = [DISNEYLAND_PARK_ID, DCA_PARK_ID].map(
    (parkId) => `/api/calendar?year=${year}&month=${month}&park=${parkId}`
  );
  const accuracyUrl = "/api/accuracy";

  preloadPromise = (async () => {
    const results = await Promise.all([
      ...forecastUrls.map(preloadJson),
      ...calendarUrls.map(preloadJson),
      preloadJson("/api/weather"),
      preloadJson(accuracyUrl),
    ]);

    const accuracy = results.at(-1) as { perRide?: { parkId: number; rideId: number }[] } | undefined;
    const firstRide = accuracy?.perRide?.[0];
    if (firstRide) {
      await preloadJson(`/api/accuracy/rides/${firstRide.rideId}?park=${firstRide.parkId}`);
    }
  })();

  return preloadPromise;
}

/** Returns a response loaded during startup, if that exact request was warmed. */
export function getStartupData<T>(url: string): T | undefined {
  return responses.get(url) as T | undefined;
}

/** Lets initial page effects wait until the loading screen has warmed the cache. */
export function waitForStartupData(): Promise<void> {
  return preloadStartupData();
}

/** Test-only reset for isolated component tests. */
export function resetStartupDataForTests(): void {
  responses.clear();
  preloadPromise = null;
}
