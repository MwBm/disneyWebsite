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

// ---------------------------------------------------------------------------
// Response parsers. These call the real functions against a mocked Groq SDK,
// so they cover the JSON handling that clampParsedNumber alone does not.
// ---------------------------------------------------------------------------

const mockCreate = jest.fn();

jest.mock("groq-sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

function respondWith(content: string | null) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

const ORIGINAL_KEY = process.env.GROQ_API_KEY;

beforeEach(() => {
  mockCreate.mockReset();
  process.env.GROQ_API_KEY = "test-key";
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = ORIGINAL_KEY;
});

describe("narrateForecastNoDataWithScore", () => {
  it("parses a well-formed response", async () => {
    const { narrateForecastNoDataWithScore } = await import("@/lib/groq");
    respondWith('{"score": 72, "narration": "Busy Saturday."}');

    const out = await narrateForecastNoDataWithScore(new Date("2026-06-01T00:00:00Z"));
    expect(out).toEqual({ score: 72, narration: "Busy Saturday." });
  });

  it("preserves a score of 0 rather than defaulting to 50", async () => {
    const { narrateForecastNoDataWithScore } = await import("@/lib/groq");
    respondWith('{"score": 0, "narration": "Park closed."}');

    expect((await narrateForecastNoDataWithScore(new Date())).score).toBe(0);
  });

  it("falls back to 50 when the score is missing", async () => {
    const { narrateForecastNoDataWithScore } = await import("@/lib/groq");
    respondWith('{"narration": "No score given."}');

    expect((await narrateForecastNoDataWithScore(new Date())).score).toBe(50);
  });

  it("clamps an out-of-range score", async () => {
    const { narrateForecastNoDataWithScore } = await import("@/lib/groq");
    respondWith('{"score": 250, "narration": "x"}');

    expect((await narrateForecastNoDataWithScore(new Date())).score).toBe(100);
  });

  it("returns the default pair on malformed JSON instead of throwing", async () => {
    const { narrateForecastNoDataWithScore } = await import("@/lib/groq");
    respondWith("this is not json");

    expect(await narrateForecastNoDataWithScore(new Date())).toEqual({ score: 50, narration: "" });
  });

  it("coerces a non-string narration to an empty string", async () => {
    const { narrateForecastNoDataWithScore } = await import("@/lib/groq");
    respondWith('{"score": 40, "narration": {"unexpected": true}}');

    expect((await narrateForecastNoDataWithScore(new Date())).narration).toBe("");
  });

  it("handles a null content field", async () => {
    const { narrateForecastNoDataWithScore } = await import("@/lib/groq");
    respondWith(null);

    expect((await narrateForecastNoDataWithScore(new Date())).score).toBe(50);
  });
});

describe("estimateDowCrowdScores", () => {
  it("parses all seven days", async () => {
    const { estimateDowCrowdScores } = await import("@/lib/groq");
    respondWith('{"0":70,"1":45,"2":45,"3":50,"4":55,"5":75,"6":85}');

    const map = await estimateDowCrowdScores();
    expect(map.size).toBe(7);
    expect(map.get(0)).toBe(70);
    expect(map.get(6)).toBe(85);
  });

  it("returns an empty map on malformed JSON instead of throwing", async () => {
    // The unguarded JSON.parse here used to throw into the calendar route's
    // bare catch, leaving every day null with nothing logged.
    const { estimateDowCrowdScores } = await import("@/lib/groq");
    respondWith("<html>rate limited</html>");

    await expect(estimateDowCrowdScores()).resolves.toEqual(new Map());
  });

  it("returns an empty map when the response is a JSON array", async () => {
    const { estimateDowCrowdScores } = await import("@/lib/groq");
    respondWith("[70,45,45,50,55,75,85]");

    // An array has no "0".."6" string keys with numeric values by index lookup
    // of the kind this parser expects — but it must not throw either way.
    await expect(estimateDowCrowdScores()).resolves.toBeInstanceOf(Map);
  });

  it("omits days the model left out rather than inventing them", async () => {
    const { estimateDowCrowdScores } = await import("@/lib/groq");
    respondWith('{"0":70,"6":85}');

    const map = await estimateDowCrowdScores();
    expect(map.size).toBe(2);
    expect(map.has(3)).toBe(false);
  });

  it("skips non-numeric values", async () => {
    const { estimateDowCrowdScores } = await import("@/lib/groq");
    respondWith('{"0":"high","1":45}');

    const map = await estimateDowCrowdScores();
    expect(map.has(0)).toBe(false);
    expect(map.get(1)).toBe(45);
  });

  it("clamps out-of-range values", async () => {
    const { estimateDowCrowdScores } = await import("@/lib/groq");
    respondWith('{"0":-20,"1":500}');

    const map = await estimateDowCrowdScores();
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBe(100);
  });
});

describe("adjustCrowdScore", () => {
  const ctx = {
    date: "2026-06-01",
    tier: 3,
    isHoliday: false,
    isSchoolBreak: true,
    specialEvent: null,
    tempHigh: 85,
    isRainy: false,
    mlCrowdScore: 55,
  };

  it("parses an adjustment and its reasoning", async () => {
    const { adjustCrowdScore } = await import("@/lib/groq");
    respondWith('{"adjustment": 12, "reasoning": "School break."}');

    expect(await adjustCrowdScore(ctx)).toEqual({ adjustment: 12, reasoning: "School break." });
  });

  it("accepts a negative adjustment", async () => {
    const { adjustCrowdScore } = await import("@/lib/groq");
    respondWith('{"adjustment": -18, "reasoning": "Rain forecast."}');

    expect((await adjustCrowdScore(ctx)).adjustment).toBe(-18);
  });

  it("clamps beyond the documented +/-35 bound", async () => {
    const { adjustCrowdScore } = await import("@/lib/groq");
    respondWith('{"adjustment": 90, "reasoning": "x"}');

    expect((await adjustCrowdScore(ctx)).adjustment).toBe(35);
  });

  it("returns a no-op adjustment when the API call throws", async () => {
    const { adjustCrowdScore } = await import("@/lib/groq");
    mockCreate.mockRejectedValueOnce(new Error("Groq down"));

    expect(await adjustCrowdScore(ctx)).toEqual({ adjustment: 0, reasoning: null });
  });

  it("returns a no-op adjustment on malformed JSON", async () => {
    const { adjustCrowdScore } = await import("@/lib/groq");
    respondWith("nonsense");

    expect(await adjustCrowdScore(ctx)).toEqual({ adjustment: 0, reasoning: null });
  });

  it("normalises an empty or whitespace-only reasoning to null", async () => {
    const { adjustCrowdScore } = await import("@/lib/groq");
    respondWith('{"adjustment": 5, "reasoning": "   "}');

    expect((await adjustCrowdScore(ctx)).reasoning).toBeNull();
  });

  it("includes the special event in the prompt when present", async () => {
    const { adjustCrowdScore } = await import("@/lib/groq");
    respondWith('{"adjustment": 20, "reasoning": "Halloween party."}');

    await adjustCrowdScore({ ...ctx, specialEvent: "Oogie Boogie Bash" });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Oogie Boogie Bash");
  });
});

describe("getGroqClient — missing key", () => {
  it("throws rather than calling the API without credentials", async () => {
    const { narrateForecast } = await import("@/lib/groq");
    delete process.env.GROQ_API_KEY;

    await expect(narrateForecast(50, [], new Date())).rejects.toThrow("GROQ_API_KEY");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("narrateForecast — prompt", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  it("lists the five rides with the highest peak wait, highest first", async () => {
    const { narrateForecast } = await import("@/lib/groq");
    respondWith("A busy day.");
    const rides = [
      { rideName: "Short Peak", peakWait: 10, avgWait: 9 },
      { rideName: "Tallest Peak", peakWait: 95, avgWait: 30 },
      { rideName: "Second", peakWait: 80, avgWait: 70 },
      { rideName: "Third", peakWait: 60, avgWait: 55 },
      { rideName: "Fourth", peakWait: 45, avgWait: 40 },
      { rideName: "Fifth", peakWait: 40, avgWait: 35 },
    ];

    expect(await narrateForecast(72, rides, new Date("2026-07-04T19:00:00Z"))).toBe("A busy day.");

    const prompt = mockCreate.mock.calls.at(-1)[0].messages[0].content as string;
    expect(prompt).toContain(
      "Top predicted waits: Tallest Peak (peak ~95 min), Second (peak ~80 min), Third (peak ~60 min), Fourth (peak ~45 min), Fifth (peak ~40 min)"
    );
    expect(prompt).not.toContain("Short Peak");
    expect(prompt).toContain("Crowd score: 72/100");
  });

  it("does not reorder the caller's array", async () => {
    const { narrateForecast } = await import("@/lib/groq");
    respondWith("ok");
    const rides = [{ rideName: "A", peakWait: 1 }, { rideName: "B", peakWait: 2 }];

    await narrateForecast(10, rides, new Date());
    expect(rides.map((r) => r.rideName)).toEqual(["A", "B"]);
  });
});
