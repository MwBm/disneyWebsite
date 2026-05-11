import { z } from "zod";
import rideConfig from "./ride-config.json";

// Sync contract: _QueueTimesResponse/_QueueTimesLand/_QueueTimesRide in ml-service/collect.py
// mirrors this schema. If queue-times.com changes shape, both parsers should fail loudly.
const RideSchema = z.object({
  id: z.number(),
  name: z.string(),
  is_open: z.boolean(),
  wait_time: z.number(),
  last_updated: z.string(),
});

const LandSchema = z.object({
  id: z.number(),
  name: z.string(),
  rides: z.array(RideSchema),
});

const QueueTimesResponseSchema = z.object({
  lands: z.array(LandSchema),
  rides: z.array(RideSchema),
});

export type RideData = {
  id: number;
  name: string;
  landName: string;
  isOpen: boolean;
  waitTime: number;
  lastUpdated: Date;
};

export class QueueTimesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueTimesError";
  }
}

async function fetchParkRides(parkConfig: typeof rideConfig.parks[number]): Promise<RideData[]> {
  const res = await fetch(parkConfig.queueTimesUrl, { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new QueueTimesError(`queue-times.com returned ${res.status} for park ${parkConfig.id}`);
  }

  const json = await res.json();
  const parsed = QueueTimesResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new QueueTimesError(
      `Unexpected queue-times.com schema for park ${parkConfig.id}: ${parsed.error.message}`
    );
  }

  const excluded = new Set(parkConfig.excludedRideIds);
  const rides: RideData[] = [];

  for (const land of parsed.data.lands) {
    for (const ride of land.rides) {
      if (excluded.has(ride.id)) continue;
      rides.push({
        id: ride.id,
        name: ride.name,
        landName: land.name,
        isOpen: ride.is_open,
        waitTime: ride.wait_time,
        lastUpdated: new Date(ride.last_updated),
      });
    }
  }

  for (const ride of parsed.data.rides) {
    if (excluded.has(ride.id)) continue;
    rides.push({
      id: ride.id,
      name: ride.name,
      landName: "Other",
      isOpen: ride.is_open,
      waitTime: ride.wait_time,
      lastUpdated: new Date(ride.last_updated),
    });
  }

  return rides;
}

export async function fetchLiveRides(): Promise<RideData[]> {
  const results = await Promise.all(
    rideConfig.parks.map((park) => fetchParkRides(park))
  );
  return results.flat();
}

export function roundToWindow(date: Date): Date {
  const ms = date.getTime();
  const windowMs = 30 * 60 * 1000;
  return new Date(Math.round(ms / windowMs) * windowMs);
}
