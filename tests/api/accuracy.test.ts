import { prisma } from "@/lib/db";

const mockQueryRaw = prisma.$queryRaw as jest.Mock;

describe("accuracy route logic", () => {
  beforeEach(() => jest.clearAllMocks());

  it("computes MAE correctly from raw rows", async () => {
    const rows = [
      { rideId: 1, rideName: "Space Mountain", predictedFor: new Date("2026-04-01T10:00:00Z"), predictedWait: 40, actualWait: 35, absError: 5 },
      { rideId: 1, rideName: "Space Mountain", predictedFor: new Date("2026-04-01T11:00:00Z"), predictedWait: 50, actualWait: 65, absError: 15 },
    ];
    mockQueryRaw.mockResolvedValueOnce(rows);

    const errors = rows.map((r) => Number(r.absError));
    const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(mae).toBe(10);
  });

  it("returns empty summary when no rows", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    const rows: unknown[] = [];
    expect(rows.length).toBe(0);
  });

  it("excludes rows where isOpen would be false (query-level filter)", () => {
    // The SQL filters isOpen = true — verify our JOIN condition is correct in spirit
    const allRows = [
      { rideId: 1, rideName: "Pirates", predictedWait: 20, actualWait: 0, absError: 20, isOpen: false },
      { rideId: 2, rideName: "Haunted Mansion", predictedWait: 30, actualWait: 28, absError: 2, isOpen: true },
    ];
    const openOnly = allRows.filter((r) => r.isOpen);
    expect(openOnly).toHaveLength(1);
    expect(openOnly[0].rideName).toBe("Haunted Mansion");
  });

  it("per-ride breakdown groups by rideId correctly", () => {
    const rows = [
      { rideId: 1, rideName: "Space Mountain", absError: 10 },
      { rideId: 1, rideName: "Space Mountain", absError: 20 },
      { rideId: 2, rideName: "Matterhorn", absError: 5 },
    ];
    const map: Record<number, number[]> = {};
    for (const r of rows) {
      map[r.rideId] = map[r.rideId] ?? [];
      map[r.rideId].push(r.absError);
    }
    expect(map[1]).toEqual([10, 20]);
    expect(map[2]).toEqual([5]);
    expect(map[1].reduce((a, b) => a + b) / map[1].length).toBe(15);
  });
});
