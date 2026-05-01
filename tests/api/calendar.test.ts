import { NextRequest } from "next/server";
import { GET } from "@/app/api/calendar/route";
import { prisma } from "@/lib/db";
import * as groqLib from "@/lib/groq";
import * as forecastLib from "@/lib/forecast";

const mockDateContextFindFirst = prisma.dateContext.findFirst as jest.Mock;
const mockDateContextUpsert = prisma.dateContext.upsert as jest.Mock;

jest.mock("@/lib/groq", () => ({
  estimateDowCrowdScores: jest.fn(),
}));

jest.mock("@/lib/forecast", () => ({
  getCrowdScoresForMonth: jest.fn(),
}));

function makeReq(year: number, month: number) {
  return new NextRequest(new URL(`http://localhost/api/calendar?year=${year}&month=${month}`));
}

// All 31 days of May 2026 with ML data
const allMlDays = Array.from({ length: 31 }, (_, i) => ({
  date: `2026-05-${String(i + 1).padStart(2, "0")}`,
  crowdScore: 50 + (i % 10),
  source: "ml" as const,
  tier: null as number | null,
  specialEvent: null as string | null,
  isHoliday: false,
}));

// Mix: some ML, some null
const daysWithGaps = allMlDays.map((d, i) =>
  i % 7 === 0 ? { ...d, crowdScore: null, source: null as null } : d
);

describe("calendar route — all ML data", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns days without calling Groq when no missing days", async () => {
    (forecastLib.getCrowdScoresForMonth as jest.Mock).mockResolvedValue(allMlDays);

    const res = await GET(makeReq(2026, 5));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.days).toHaveLength(31);
    expect(groqLib.estimateDowCrowdScores).not.toHaveBeenCalled();
    expect(mockDateContextFindFirst).not.toHaveBeenCalled();
  });
});

describe("calendar route — cached Groq DOW", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uses DB-cached Groq DOW when available, skips live call", async () => {
    (forecastLib.getCrowdScoresForMonth as jest.Mock).mockResolvedValue(daysWithGaps);
    mockDateContextFindFirst.mockResolvedValue({
      groqDowEstimate: { "0": 70, "1": 45, "2": 45, "3": 50, "4": 55, "5": 75, "6": 85 },
    });

    const res = await GET(makeReq(2026, 5));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(groqLib.estimateDowCrowdScores).not.toHaveBeenCalled();
    // Null days should be filled in
    const nullDays = body.days.filter((d: { source: string }) => d.source === null);
    expect(nullDays).toHaveLength(0);
    const groqDays = body.days.filter((d: { source: string }) => d.source === "groq");
    expect(groqDays.length).toBeGreaterThan(0);
  });

  it("fills null days with correct DOW-based score from cache", async () => {
    (forecastLib.getCrowdScoresForMonth as jest.Mock).mockResolvedValue([
      { date: "2026-05-03", crowdScore: null, source: null, tier: null, specialEvent: null, isHoliday: false }, // Sunday (DOW=0)
    ]);
    mockDateContextFindFirst.mockResolvedValue({
      groqDowEstimate: { "0": 72 },
    });

    const res = await GET(makeReq(2026, 5));
    const body = await res.json();

    const day = body.days.find((d: { date: string }) => d.date === "2026-05-03");
    expect(day.crowdScore).toBe(72);
    expect(day.source).toBe("groq");
  });
});

describe("calendar route — live Groq call and cache save", () => {
  // resetAllMocks (not just clearAllMocks) to prevent implementation leakage from
  // the prior describe block's findFirst mock into this block.
  beforeEach(() => jest.resetAllMocks());

  it("calls Groq when no DB cache and persists result", async () => {
    (forecastLib.getCrowdScoresForMonth as jest.Mock).mockResolvedValue(daysWithGaps);
    mockDateContextFindFirst.mockResolvedValue(null);
    (groqLib.estimateDowCrowdScores as jest.Mock).mockResolvedValue(
      new Map([[0, 70], [1, 45], [2, 45], [3, 50], [4, 55], [5, 75], [6, 85]])
    );
    mockDateContextUpsert.mockResolvedValue({});

    await GET(makeReq(2026, 5));

    expect(groqLib.estimateDowCrowdScores).toHaveBeenCalledTimes(1);
    expect(mockDateContextUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ groqDowEstimate: expect.any(Object) }),
      })
    );
  });

  it("leaves null days when Groq throws and no cache", async () => {
    (forecastLib.getCrowdScoresForMonth as jest.Mock).mockResolvedValue([
      { date: "2026-05-03", crowdScore: null, source: null, tier: null, specialEvent: null, isHoliday: false },
    ]);
    mockDateContextFindFirst.mockResolvedValue(null);
    (groqLib.estimateDowCrowdScores as jest.Mock).mockRejectedValue(new Error("Groq down"));

    const res = await GET(makeReq(2026, 5));
    const body = await res.json();

    const day = body.days[0];
    expect(day.source).toBeNull();
    expect(mockDateContextUpsert).not.toHaveBeenCalled();
  });
});

describe("calendar route — validation", () => {
  it("returns 400 for missing params", async () => {
    const req = new NextRequest(new URL("http://localhost/api/calendar"));
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for out-of-range month", async () => {
    const res = await GET(makeReq(2026, 13));
    expect(res.status).toBe(400);
  });

  it("returns 400 for out-of-range year", async () => {
    const res = await GET(makeReq(2019, 6));
    expect(res.status).toBe(400);
  });
});
