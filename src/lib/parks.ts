import rideConfig from "./ride-config.json";

export type ParkName = "Disneyland" | "Disney California Adventure";
export type ParkId = 16 | 17;

/**
 * Lands belonging to Disney California Adventure.
 *
 * queue-times.com reports a land name per ride but not which park the land is
 * in, and the two parks share a `landName` column.
 */
const DCA_LANDS: ReadonlySet<string> = new Set([
  "Avengers Campus",
  "Cars Land",
  "Grizzly Peak",
  "Hollywood Land",
  "Paradise Gardens Park",
  "Pixar Pier",
  "San Fransokyo Square",
]);

export const DISNEYLAND: ParkName = "Disneyland";
export const DCA: ParkName = "Disney California Adventure";
export const DISNEYLAND_PARK_ID = 16 as const;
export const DCA_PARK_ID = 17 as const;
export const PARK_IDS = [DISNEYLAND_PARK_ID, DCA_PARK_ID] as const;

export const PARK_LABELS: Record<ParkId, string> = {
  [DISNEYLAND_PARK_ID]: DISNEYLAND,
  [DCA_PARK_ID]: DCA,
};

export function isParkId(value: number): value is ParkId {
  return PARK_IDS.includes(value as ParkId);
}

/**
 * Falls back to Disneyland for an unrecognised land — a newly opened land
 * would otherwise have no park at all, and Disneyland is the larger of the two.
 */
export function getParkName(landName: string): ParkName {
  return DCA_LANDS.has(landName) ? DCA : DISNEYLAND;
}

/** Park identity for legacy rows that pre-date the explicit `parkId` column. */
export function getParkId(landName: string): ParkId {
  return DCA_LANDS.has(landName) ? DCA_PARK_ID : DISNEYLAND_PARK_ID;
}

/** Park display names as configured for data collection. */
export const CONFIGURED_PARKS: readonly string[] = rideConfig.parks.map((p) => p.name);
