import { buildChatSystemPrompt } from "@/lib/groq";
describe("buildChatSystemPrompt", () => {
  it("separates a selected future-date forecast from live waits", () => {
    const prompt = buildChatSystemPrompt({
      now: new Date("2026-06-02T03:30:00.000Z"),
      visitDate: "2026-07-04",
      crowdScore: 82,
      visitForecastSource: "ml",
      visitForecasts: [{ rideName: "Space Mountain", landName: "Tomorrowland", avgWait: 45, peakWait: 75 }],
      liveWaits: [{ name: "Matterhorn", waitTime: 35, isOpen: true }],
    });

    expect(prompt).toContain("Selected visit date: Saturday, July 4, 2026");
    expect(prompt).toContain("ML predictions for the selected date");
    expect(prompt).toContain("Space Mountain (Tomorrowland): avg ~45 min, peak ~75 min");
    expect(prompt).toContain("Selected-date lowest-wait ride forecasts:");
    expect(prompt).toContain("Current top wait times (these are live now, not a prediction for the selected date)");
    expect(prompt).toContain("Reply style:");
    // 03:30 UTC is still June 1 in Anaheim.
    expect(prompt).toContain("Current park date/time (America/Los_Angeles): Monday, June 1, 2026");
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
