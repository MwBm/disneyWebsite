import { DCA, DISNEYLAND, type ParkName } from "@/lib/parks";

export type PerRide = {
  parkId: number;
  rideId: number;
  rideName: string;
  landName: string;
  parkName: string;
  mae: number;
  within10: number;
  sampleCount: number;
};

export type ParkFilter = "all" | ParkName;
export type SortKey = "mae-asc" | "mae-desc" | "alpha" | "samples-desc";

export type RideGroup = {
  parkName: ParkName;
  rides: PerRide[];
};

export function filterAndSortRides(
  rides: PerRide[],
  parkFilter: ParkFilter,
  search: string,
  sortKey: SortKey
): PerRide[] {
  let result = parkFilter === "all" ? rides : rides.filter((r) => r.parkName === parkFilter);

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    result = result.filter((r) => r.rideName.toLowerCase().includes(q));
  }

  switch (sortKey) {
    case "mae-asc":      return [...result].sort((a, b) => a.mae - b.mae);
    case "mae-desc":     return [...result].sort((a, b) => b.mae - a.mae);
    case "alpha":        return [...result].sort((a, b) => a.rideName.localeCompare(b.rideName));
    case "samples-desc": return [...result].sort((a, b) => b.sampleCount - a.sampleCount);
  }
}

/** Keeps the combined accuracy view organised by park while preserving its sort. */
export function groupRidesByPark(
  rides: PerRide[],
  search: string,
  sortKey: SortKey
): RideGroup[] {
  return [DISNEYLAND, DCA].map((parkName) => ({
    parkName,
    rides: filterAndSortRides(rides, parkName, search, sortKey),
  })).filter((group) => group.rides.length > 0);
}
