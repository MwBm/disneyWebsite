import {
  dateContextMonthRangeUtc,
  parkDateKey,
  parkDateRangeUtc,
  parkMonthRangeUtc,
} from "@/lib/park-time";

describe("park-time helpers", () => {
  it("builds Pacific day bounds in standard time", () => {
    const range = parkDateRangeUtc("2026-01-15");

    expect(range.start.toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-01-16T08:00:00.000Z");
  });

  it("builds Pacific day bounds in daylight time", () => {
    const range = parkDateRangeUtc("2026-06-01");

    expect(range.start.toISOString()).toBe("2026-06-01T07:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-06-02T07:00:00.000Z");
  });

  it("groups late UTC slots under the prior Pacific date", () => {
    expect(parkDateKey(new Date("2026-06-02T03:30:00.000Z"))).toBe("2026-06-01");
  });

  it("builds a Pacific month range and a UTC DateContext month range", () => {
    expect(parkMonthRangeUtc(2026, 12).start.toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(parkMonthRangeUtc(2026, 12).endExclusive.toISOString()).toBe("2027-01-01T08:00:00.000Z");
    expect(dateContextMonthRangeUtc(2026, 12).endExclusive.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
