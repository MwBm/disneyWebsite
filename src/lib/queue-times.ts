import { z } from "zod";

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

export async function fetchLiveRides(): Promise<RideData[]> {
  const res = await fetch(
    "https://queue-times.com/en-US/parks/16/queue_times.json",
    { next: { revalidate: 0 } }
  );

  if (!res.ok) {
    throw new QueueTimesError(`queue-times.com returned ${res.status}`);
  }

  const json = await res.json();
  const parsed = QueueTimesResponseSchema.safeParse(json);

  if (!parsed.success) {
    throw new QueueTimesError(
      `Unexpected queue-times.com schema: ${parsed.error.message}`
    );
  }

  const rides: RideData[] = [];

  for (const land of parsed.data.lands) {
    for (const ride of land.rides) {
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

export function roundToWindow(date: Date): Date {
  const ms = date.getTime();
  const windowMs = 30 * 60 * 1000;
  return new Date(Math.round(ms / windowMs) * windowMs);
}
