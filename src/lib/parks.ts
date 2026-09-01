import rideConfig from "./ride-config.json";

export type ParkName = "Disneyland" | "Disney California Adventure";

/**
 * Lands belonging to Disney California Adventure.
 *
 * queue-times.com reports a land name per ride but not which park the land is
 * in, and the two parks share a `landName` column, so the mapping has to live
 * somewhere. It was previously inlined in the accuracy route while
 * ride-config.json separately defined both parks — this is that one place.
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

/**
 * Falls back to Disneyland for an unrecognised land — a newly opened land
 * would otherwise have no park at all, and Disneyland is the larger of the two.
 */
export function getParkName(landName: string): ParkName {
  return DCA_LANDS.has(landName) ? DCA : DISNEYLAND;
}

/** Park display names as configured for data collection. */
export const CONFIGURED_PARKS: readonly string[] = rideConfig.parks.map((p) => p.name);
