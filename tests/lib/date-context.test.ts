import { syncDateContext } from "@/lib/date-context";
import { fetchDateSchedule } from "@/lib/park-schedule";
import { isHolidayDate, isSchoolBreakDate } from "@/lib/calendar";
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

describe("isHolidayDate", () => {
  it("flags fixed holidays", () => {
    expect(isHolidayDate(new Date("2026-01-01"))).toBe(true);  // New Year's Day
    expect(isHolidayDate(new Date("2026-07-04"))).toBe(true);  // Independence Day
    expect(isHolidayDate(new Date("2026-11-11"))).toBe(true);  // Veterans Day
    expect(isHolidayDate(new Date("2026-12-24"))).toBe(true);  // Christmas Eve
    expect(isHolidayDate(new Date("2026-12-25"))).toBe(true);  // Christmas Day
    expect(isHolidayDate(new Date("2026-12-31"))).toBe(true);  // New Year's Eve
  });

  it("flags floating federal holidays", () => {
    // Memorial Day 2026 = May 25
    expect(isHolidayDate(new Date("2026-05-25"))).toBe(true);
    // Labor Day 2026 = Sep 7
    expect(isHolidayDate(new Date("2026-09-07"))).toBe(true);
    // Columbus Day 2026 = Oct 12
    expect(isHolidayDate(new Date("2026-10-12"))).toBe(true);
    // Thanksgiving 2026 = Nov 26
    expect(isHolidayDate(new Date("2026-11-26"))).toBe(true);
  });

  it("flags Easter weekend (Good Friday through Easter Monday)", () => {
    // Easter 2026 = Apr 5; Good Friday = Apr 3, Easter Monday = Apr 6
    expect(isHolidayDate(new Date("2026-04-03"))).toBe(true);  // Good Friday
    expect(isHolidayDate(new Date("2026-04-04"))).toBe(true);  // Holy Saturday
    expect(isHolidayDate(new Date("2026-04-05"))).toBe(true);  // Easter Sunday
    expect(isHolidayDate(new Date("2026-04-06"))).toBe(true);  // Easter Monday
    // Day outside Easter weekend should not be flagged
    expect(isHolidayDate(new Date("2026-04-02"))).toBe(false); // Maundy Thursday
    // Easter 2027 = Mar 28; Good Friday = Mar 26
    expect(isHolidayDate(new Date("2027-03-26"))).toBe(true);  // Good Friday 2027
    expect(isHolidayDate(new Date("2027-03-28"))).toBe(true);  // Easter 2027
  });

  it("does not flag ordinary days", () => {
    expect(isHolidayDate(new Date("2026-06-15"))).toBe(false);
    expect(isHolidayDate(new Date("2026-03-10"))).toBe(false);
    expect(isHolidayDate(new Date("2026-10-01"))).toBe(false);
  });
});

describe("isSchoolBreakDate", () => {
  it("flags winter break (CA: Dec 19 – Jan 7)", () => {
    expect(isSchoolBreakDate(new Date("2026-12-19"))).toBe(true); // CA start
    expect(isSchoolBreakDate(new Date("2026-12-22"))).toBe(true);
    expect(isSchoolBreakDate(new Date("2027-01-01"))).toBe(true);
    expect(isSchoolBreakDate(new Date("2027-01-05"))).toBe(true);
    expect(isSchoolBreakDate(new Date("2027-01-07"))).toBe(true); // CA end
    expect(isSchoolBreakDate(new Date("2027-01-08"))).toBe(false); // back to school
  });

  it("flags summer break (CA: Jun 12 – Aug 25)", () => {
    expect(isSchoolBreakDate(new Date("2026-06-12"))).toBe(true); // CA start
    expect(isSchoolBreakDate(new Date("2026-06-15"))).toBe(true);
    expect(isSchoolBreakDate(new Date("2026-07-15"))).toBe(true);
    expect(isSchoolBreakDate(new Date("2026-08-20"))).toBe(true);
    expect(isSchoolBreakDate(new Date("2026-08-25"))).toBe(true); // CA end
    expect(isSchoolBreakDate(new Date("2026-08-26"))).toBe(false); // back to school
  });

  it("flags spring break (CA: Mar 21 – Apr 18)", () => {
    expect(isSchoolBreakDate(new Date("2026-03-21"))).toBe(true); // CA start
    expect(isSchoolBreakDate(new Date("2026-03-25"))).toBe(true);
    expect(isSchoolBreakDate(new Date("2026-04-01"))).toBe(true);
    expect(isSchoolBreakDate(new Date("2026-04-15"))).toBe(true); // late CA districts
    expect(isSchoolBreakDate(new Date("2026-04-18"))).toBe(true); // CA end
    expect(isSchoolBreakDate(new Date("2026-04-19"))).toBe(false); // back to school
  });

  it("does not flag ordinary school days", () => {
    expect(isSchoolBreakDate(new Date("2026-02-15"))).toBe(false);
    expect(isSchoolBreakDate(new Date("2026-03-20"))).toBe(false); // day before spring break
    expect(isSchoolBreakDate(new Date("2026-10-01"))).toBe(false);
    expect(isSchoolBreakDate(new Date("2026-11-01"))).toBe(false);
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
        update: expect.objectContaining({ tierSource: "themeparks-wiki", isHoliday: false, isSchoolBreak: false }),
      })
    );
  });

  it("persists isHoliday=true on Jul 4", async () => {
    mockDateContextFindMany.mockResolvedValue([]);
    mockFetch(makeScheduleResponse([
      { date: "2026-07-04", type: "OPERATING", openingTime: "2026-07-04T08:00:00-07:00", closingTime: "2026-07-04T23:00:00-07:00", purchases: [] },
    ]));
    mockDateContextUpsert.mockResolvedValue({});
    await syncDateContext(1);
    expect(mockDateContextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ isHoliday: true, isSchoolBreak: true }),
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
