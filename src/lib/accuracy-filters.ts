export type PerRide = {
  rideId: number;
  rideName: string;
  landName: string;
  parkName: string;
  mae: number;
  within10: number;
  sampleCount: number;
};

export type ParkFilter = "all" | "Disneyland" | "Disney California Adventure";
export type SortKey = "mae-asc" | "mae-desc" | "alpha" | "samples-desc";

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
