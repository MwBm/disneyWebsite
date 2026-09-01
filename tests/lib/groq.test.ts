import { clampParsedNumber } from "@/lib/groq";

describe("clampParsedNumber — the falsy-zero bug", () => {
  it("keeps a legitimate 0 instead of substituting the fallback", () => {
    // Regression guard for `Number(parsed.score) || 50`, which rewrote a
    // correct score of 0 (closed park, dead January weekday) to dead average.
    expect(clampParsedNumber(0, { min: 0, max: 100, fallback: 50 })).toBe(0);
  });

  it('keeps the string "0" as 0', () => {
    expect(clampParsedNumber("0", { min: 0, max: 100, fallback: 50 })).toBe(0);
  });

  it("keeps a legitimate negative value on a signed range", () => {
    expect(clampParsedNumber(-12, { min: -35, max: 35, fallback: 0 })).toBe(-12);
  });
});

describe("clampParsedNumber — clamping", () => {
  it("clamps above the max", () => {
    expect(clampParsedNumber(9001, { min: 0, max: 100, fallback: 50 })).toBe(100);
  });

  it("clamps below the min", () => {
    expect(clampParsedNumber(-9001, { min: 0, max: 100, fallback: 50 })).toBe(0);
  });

  it("clamps a signed range at both ends", () => {
    expect(clampParsedNumber(80, { min: -35, max: 35, fallback: 0 })).toBe(35);
    expect(clampParsedNumber(-80, { min: -35, max: 35, fallback: 0 })).toBe(-35);
  });

  it("rounds a fractional value", () => {
    expect(clampParsedNumber(42.6, { min: 0, max: 100, fallback: 50 })).toBe(43);
  });

  it("passes a value already inside the range through unchanged", () => {
    expect(clampParsedNumber(37, { min: 0, max: 100, fallback: 50 })).toBe(37);
  });
});

describe("clampParsedNumber — junk input falls back", () => {
  const fallbackCases: [string, unknown][] = [
    ["undefined (key absent from the JSON)", undefined],
    ["null", null],
    ["a non-numeric string", "high"],
    ["an empty string", ""],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["an object", { score: 40 }],
    ["an array", [40]],
    ["a boolean", true],
  ];

  it.each(fallbackCases)("falls back for %s", (_label, value) => {
    expect(clampParsedNumber(value, { min: 0, max: 100, fallback: 50 })).toBe(50);
  });

  it("does not coerce an empty array to 0 the way Number() would", () => {
    // Number([]) is 0, which would silently become a real score.
    expect(clampParsedNumber([], { min: 0, max: 100, fallback: 50 })).toBe(50);
  });

  it("does not coerce true to 1 the way Number() would", () => {
    expect(clampParsedNumber(true, { min: 0, max: 100, fallback: 50 })).toBe(50);
  });
});
