import { syncGroqAdjustments } from "@/lib/date-context";
import { prisma } from "@/lib/db";
import * as groq from "@/lib/groq";
import * as queries from "@/lib/forecast-queries";

jest.mock("@/lib/groq", () => ({ adjustCrowdScore: jest.fn() }));
jest.mock("@/lib/forecast-queries", () => ({ getDailyMlCrowdScores: jest.fn() }));

const mockFindMany = prisma.dateContext.findMany as jest.Mock;
const mockUpdate = prisma.dateContext.update as jest.Mock;
const mockAdjust = groq.adjustCrowdScore as jest.Mock;
const mockDailyScores = queries.getDailyMlCrowdScores as jest.Mock;

function pendingContext(id: string, date: string, extra: object = {}) {
  return {
    id,
    date: new Date(`${date}T00:00:00Z`),
    tier: 2,
    isHoliday: false,
    isSchoolBreak: false,
    specialEvent: null,
    tempHigh: 80,
    isRainy: null,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdjust.mockResolvedValue({ adjustment: 4, reasoning: "Busy weekend" });
  mockUpdate.mockResolvedValue({});
});

describe("syncGroqAdjustments", () => {
  it("does no work when nothing is pending", async () => {
    mockFindMany.mockResolvedValue([]);

    expect(await syncGroqAdjustments()).toEqual({ adjusted: 0 });
    expect(mockDailyScores).not.toHaveBeenCalled();
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("reads daily ML scores once, over the park-local span of the pending dates", async () => {
    // Unsorted on purpose: the span must still run from the earliest to the latest date.
    mockFindMany.mockResolvedValue([pendingContext("b", "2026-07-04"), pendingContext("a", "2026-06-30")]);
    mockDailyScores.mockResolvedValue(new Map());

    await syncGroqAdjustments();

    expect(mockDailyScores).toHaveBeenCalledTimes(1);
    expect(mockDailyScores).toHaveBeenCalledWith(new Date("2026-06-30T07:00:00Z"), new Date("2026-07-05T07:00:00Z"));
  });

  it("passes each date's own ML score to the Groq adjuster and stores the result", async () => {
    mockFindMany.mockResolvedValue([pendingContext("ctx-1", "2026-07-04", { isHoliday: true, isRainy: true })]);
    mockDailyScores.mockResolvedValue(new Map([["2026-07-04", 73], ["2026-07-05", 12]]));

    expect(await syncGroqAdjustments()).toEqual({ adjusted: 1 });

    expect(mockAdjust).toHaveBeenCalledWith({
      date: "2026-07-04",
      tier: 2,
      isHoliday: true,
      isSchoolBreak: false,
      specialEvent: null,
      tempHigh: 80,
      isRainy: true,
      mlCrowdScore: 73,
    });
    const update = mockUpdate.mock.calls[0][0];
    expect(update.where).toEqual({ id: "ctx-1" });
    expect(update.data).toMatchObject({ groqAdjustment: 4, groqReasoning: "Busy weekend" });
    expect(update.data.groqAdjustedAt).toBeInstanceOf(Date);
  });

  it("falls back to 50 for a date with no ML forecast and treats a null tier and rain as 0/false", async () => {
    mockFindMany.mockResolvedValue([pendingContext("ctx-2", "2026-12-01", { tier: null, isRainy: null })]);
    mockDailyScores.mockResolvedValue(new Map());

    await syncGroqAdjustments();

    expect(mockAdjust).toHaveBeenCalledWith(expect.objectContaining({ mlCrowdScore: 50, tier: 0, isRainy: false }));
  });

  it("counts only the updates that succeeded", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockFindMany.mockResolvedValue([pendingContext("ok", "2026-07-01"), pendingContext("bad", "2026-07-02")]);
    mockDailyScores.mockResolvedValue(new Map());
    mockUpdate.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === "bad" ? Promise.reject(new Error("write failed")) : Promise.resolve({})
    );

    expect(await syncGroqAdjustments()).toEqual({ adjusted: 1 });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("1/2 updates failed"), expect.any(Error));
    consoleError.mockRestore();
  });
});
