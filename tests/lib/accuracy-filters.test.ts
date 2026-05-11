import { filterAndSortRides } from "@/lib/accuracy-filters";
import type { PerRide } from "@/lib/accuracy-filters";

const rides: PerRide[] = [
  { rideId: 1, rideName: "Space Mountain",    landName: "Tomorrowland",        parkName: "Disneyland",                    mae: 8.2, within10: 0.72, sampleCount: 100 },
  { rideId: 2, rideName: "Guardians",          landName: "Avengers Campus",     parkName: "Disney California Adventure",   mae: 3.1, within10: 0.91, sampleCount: 50  },
  { rideId: 3, rideName: "Haunted Mansion",    landName: "New Orleans Square",  parkName: "Disneyland",                    mae: 5.5, within10: 0.83, sampleCount: 80  },
  { rideId: 4, rideName: "Radiator Springs",   landName: "Cars Land",           parkName: "Disney California Adventure",   mae: 12.0, within10: 0.60, sampleCount: 120 },
];

describe("filterAndSortRides", () => {
  it("returns all rides with no filters", () => {
    expect(filterAndSortRides(rides, "all", "", "alpha")).toHaveLength(4);
  });

  it("filters by Disneyland park", () => {
    const result = filterAndSortRides(rides, "Disneyland", "", "alpha");
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.parkName === "Disneyland")).toBe(true);
  });

  it("filters by DCA park", () => {
    const result = filterAndSortRides(rides, "Disney California Adventure", "", "alpha");
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.parkName === "Disney California Adventure")).toBe(true);
  });

  it("filters by search query (case insensitive)", () => {
    const result = filterAndSortRides(rides, "all", "mountain", "alpha");
    expect(result).toHaveLength(1);
    expect(result[0].rideName).toBe("Space Mountain");
  });

  it("search with no match returns empty array", () => {
    expect(filterAndSortRides(rides, "all", "matterhorn", "alpha")).toHaveLength(0);
  });

  it("sorts by mae ascending", () => {
    const result = filterAndSortRides(rides, "all", "", "mae-asc");
    expect(result[0].mae).toBe(3.1);
    expect(result[3].mae).toBe(12.0);
  });

  it("sorts by mae descending", () => {
    const result = filterAndSortRides(rides, "all", "", "mae-desc");
    expect(result[0].mae).toBe(12.0);
    expect(result[3].mae).toBe(3.1);
  });

  it("sorts alphabetically", () => {
    const result = filterAndSortRides(rides, "all", "", "alpha");
    expect(result[0].rideName).toBe("Guardians");
    expect(result[1].rideName).toBe("Haunted Mansion");
  });

  it("sorts by sample count descending", () => {
    const result = filterAndSortRides(rides, "all", "", "samples-desc");
    expect(result[0].sampleCount).toBe(120);
    expect(result[3].sampleCount).toBe(50);
  });

  it("combines park filter + search + sort", () => {
    const result = filterAndSortRides(rides, "Disneyland", "m", "mae-asc");
    expect(result).toHaveLength(2); // Space Mountain + Haunted Mansion
    expect(result[0].rideName).toBe("Haunted Mansion"); // mae 5.5 < 8.2
  });

  it("does not mutate input array", () => {
    const original = [...rides];
    filterAndSortRides(rides, "all", "", "mae-asc");
    expect(rides).toEqual(original);
  });
});
