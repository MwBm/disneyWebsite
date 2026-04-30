import { fetchDateSchedule, syncDateContext } from "@/lib/date-context";
import { prisma } from "@/lib/db";

const mockDateContextFindMany = prisma.dateContext.findMany as jest.Mock;
const mockDateContextUpsert = prisma.dateContext.upsert as jest.Mock;

const PARK_ID = "7340550b-c14d-4def-80bb-acdb51d49a66";

function makeScheduleResponse(entries: object[]) {
  return { schedule: entries };
}

function mockFetch(body: object, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("fetchDateSchedule", () => {
  afterEach(() => jest.restoreAllMocks());

  it("calls ThemeParks.wiki with correct URL", async () => {
    mockFetch(makeScheduleResponse([]));
    await fetchDateSchedule("2026-06-01", "2026-06-30");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(PARK_ID)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("startDate=2026-06-01")
    );
  });

  it("throws when API returns non-ok status", async () => {
    mockFetch({}, 503);
    await expect(fetchDateSchedule("2026-06-01", "2026-06-01")).rejects.toThrow("503");
  });

  it("returns empty array when schedule is empty", async () => {
    mockFetch(makeScheduleResponse([]));
    const result = await fetchDateSchedule("2026-06-01", "2026-06-01");
    expect(result).toEqual([]);
  });

  it("derives tier from LLMP price when present", async () => {
    mockFetch(makeScheduleResponse([
      {
        date: "2026-06-01",
        type: "OPERATING",
        openingTime: "2026-06-01T08:00:00-07:00",
        closingTime: "2026-06-01T23:00:00-07:00",
        purchases: [
          { id: "lightninglanemultipass_330339", price: { amount: 3700 } },
        ],
      },
    ]));
    const result = await fetchDateSchedule("2026-06-01", "2026-06-01");
    expect(result[0].tier).toBe(4); // 3700 cents → tier 4
  });

  it("falls back to park hours when no LLMP price", async () => {
    mockFetch(makeScheduleResponse([
      {
        date: "2026-06-01",
        type: "OPERATING",
        openingTime: "2026-06-01T08:00:00-07:00",
        closingTime: "2026-06-01T23:00:00-07:00", // 15h
        purchases: [],
      },
    ]));
    const result = await fetchDateSchedule("2026-06-01", "2026-06-01");
    expect(result[0].tier).toBe(3); // 15h → tier 3
  });

  it("defaults to tier 2 when no hours or price", async () => {
    mockFetch(makeScheduleResponse([
      { date: "2026-06-01", type: "INFO", description: "Park Hopping" },
    ]));
    const result = await fetchDateSchedule("2026-06-01", "2026-06-01");
    expect(result[0].tier).toBe(2);
  });

  it("captures TICKETED_EVENT as specialEvent", async () => {
    mockFetch(makeScheduleResponse([
      {
        date: "2026-06-01",
        type: "OPERATING",
        openingTime: "2026-06-01T08:00:00-07:00",
        closingTime: "2026-06-01T20:00:00-07:00",
        purchases: [],
      },
      {
        date: "2026-06-01",
        type: "TICKETED_EVENT",
        description: "Oogie Boogie Bash",
        openingTime: "2026-06-01T21:00:00-07:00",
        closingTime: "2026-06-02T01:00:00-07:00",
      },
    ]));
    const result = await fetchDateSchedule("2026-06-01", "2026-06-01");
    expect(result[0].specialEvent).toBe("Oogie Boogie Bash");
  });

  it("sets specialEvent to null when no ticketed event", async () => {
    mockFetch(makeScheduleResponse([
      {
        date: "2026-06-01",
        type: "OPERATING",
        openingTime: "2026-06-01T08:00:00-07:00",
        closingTime: "2026-06-01T23:00:00-07:00",
        purchases: [],
      },
    ]));
    const result = await fetchDateSchedule("2026-06-01", "2026-06-01");
    expect(result[0].specialEvent).toBeNull();
  });

  describe("llmpCentsToTier boundaries", () => {
    const cases: [number, number][] = [
      [2500, 0],
      [2501, 1],
      [2800, 1],
      [2801, 2],
      [3100, 2],
      [3101, 3],
      [3500, 3],
      [3501, 4],
      [3900, 4],
      [3901, 5],
    ];
    it.each(cases)("LLMP %i cents → tier %i", async (cents, expectedTier) => {
      mockFetch(makeScheduleResponse([
        {
          date: "2026-06-01",
          type: "OPERATING",
          openingTime: "2026-06-01T08:00:00-07:00",
          closingTime: "2026-06-01T23:00:00-07:00",
          purchases: [{ id: "lightninglanemultipass_330339", price: { amount: cents } }],
        },
      ]));
      const result = await fetchDateSchedule("2026-06-01", "2026-06-01");
      expect(result[0].tier).toBe(expectedTier);
    });
  });

  describe("parkHoursToTier boundaries", () => {
    const cases: [string, string, number][] = [
      ["08:00", "20:00", 0], // 12h → tier 0
      ["08:00", "21:00", 1], // 13h → tier 1
      ["08:00", "22:00", 2], // 14h → tier 2
      ["08:00", "23:00", 3], // 15h → tier 3
      ["08:00", "00:00", 4], // 16h → tier 4 (midnight next day)
      ["08:00", "01:00", 5], // 17h → tier 5
    ];
    it.each(cases)("open %s close +%s → tier %i", async (openH, closeH, expectedTier) => {
      const open = `2026-06-01T${openH}:00-07:00`;
      const closeDay = closeH < openH ? "2026-06-02" : "2026-06-01";
      const close = `${closeDay}T${closeH}:00-07:00`;
      mockFetch(makeScheduleResponse([
        { date: "2026-06-01", type: "OPERATING", openingTime: open, closingTime: close, purchases: [] },
      ]));
      const result = await fetchDateSchedule("2026-06-01", "2026-06-01");
      expect(result[0].tier).toBe(expectedTier);
    });
  });
});

describe("syncDateContext", () => {
  beforeEach(() => jest.clearAllMocks());

  it("skips all dates when all are fresh (fetched within 24h)", async () => {
    const now = new Date();
    mockDateContextFindMany.mockResolvedValue([
      { date: new Date(now.toISOString().slice(0, 10)) },
    ]);
    mockFetch(makeScheduleResponse([
      {
        date: now.toISOString().slice(0, 10),
        type: "OPERATING",
        openingTime: `${now.toISOString().slice(0, 10)}T08:00:00Z`,
        closingTime: `${now.toISOString().slice(0, 10)}T23:00:00Z`,
        purchases: [],
      },
    ]));
    const result = await syncDateContext(1);
    expect(result.synced).toBe(0);
    expect(mockDateContextUpsert).not.toHaveBeenCalled();
  });

  it("syncs stale dates", async () => {
    mockDateContextFindMany.mockResolvedValue([]); // nothing fresh
    mockFetch(makeScheduleResponse([
      {
        date: "2026-06-01",
        type: "OPERATING",
        openingTime: "2026-06-01T08:00:00-07:00",
        closingTime: "2026-06-01T23:00:00-07:00",
        purchases: [],
      },
    ]));
    mockDateContextUpsert.mockResolvedValue({});
    await syncDateContext(1);
    expect(mockDateContextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ tierSource: "themeparks-wiki" }),
      })
    );
  });

  it("returns correct synced/skipped counts", async () => {
    mockDateContextFindMany.mockResolvedValue([
      { date: new Date("2026-06-01") }, // fresh
    ]);
    mockFetch(makeScheduleResponse([
      {
        date: "2026-06-01",
        type: "OPERATING",
        openingTime: "2026-06-01T08:00:00-07:00",
        closingTime: "2026-06-01T23:00:00-07:00",
        purchases: [],
      },
      {
        date: "2026-06-02",
        type: "OPERATING",
        openingTime: "2026-06-02T08:00:00-07:00",
        closingTime: "2026-06-02T23:00:00-07:00",
        purchases: [],
      },
    ]));
    mockDateContextUpsert.mockResolvedValue({});
    const result = await syncDateContext(2);
    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(1);
  });
});
