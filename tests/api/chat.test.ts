import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/route";
import { _resetRateLimits } from "@/lib/rate-limit";
import * as forecast from "@/lib/forecast";
import * as queries from "@/lib/forecast-queries";
import * as queueTimes from "@/lib/queue-times";

const mockCreate = jest.fn();

jest.mock("groq-sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

jest.mock("@/lib/forecast", () => ({ getCrowdScoreForDate: jest.fn() }));
jest.mock("@/lib/forecast-queries", () => ({
  getRideForecastsForDate: jest.fn(),
  getHistoricalRideWaitsForDate: jest.fn(),
}));
jest.mock("@/lib/queue-times", () => ({ fetchLiveRides: jest.fn() }));

const mockCrowdScore = forecast.getCrowdScoreForDate as jest.Mock;
const mockMlForecasts = queries.getRideForecastsForDate as jest.Mock;
const mockHistoricalForecasts = queries.getHistoricalRideWaitsForDate as jest.Mock;
const mockLiveRides = queueTimes.fetchLiveRides as jest.Mock;

function streamResponse(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: text } }] };
    },
  };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("chat route — selected trip date", () => {
  const originalKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
    _resetRateLimits();
    jest.clearAllMocks();
    mockLiveRides.mockResolvedValue([{ name: "Matterhorn", waitTime: 35, isOpen: true }]);
    mockCrowdScore.mockResolvedValue(81);
    mockMlForecasts.mockResolvedValue([
      { rideName: "Space Mountain", landName: "Tomorrowland", avgWait: 45, peakWait: 75 },
    ]);
    mockHistoricalForecasts.mockResolvedValue([]);
    mockCreate.mockResolvedValue(streamResponse("A useful answer."));
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  });

  it("queries and supplies ML context for the requested future date", async () => {
    const response = await POST(request({
      date: "2026-07-04",
      messages: [{ role: "user", content: "How should we plan the day?" }],
    }));

    expect(await response.text()).toBe("A useful answer.");
    expect(mockCrowdScore).toHaveBeenCalledWith("2026-07-04");
    expect(mockMlForecasts).toHaveBeenCalledWith("2026-07-04");
    expect(mockHistoricalForecasts).not.toHaveBeenCalled();

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Selected visit date: Saturday, July 4, 2026");
    expect(prompt).toContain("ML predictions for the selected date");
  });

  it("falls back to historical per-ride context for a date outside the ML window", async () => {
    mockMlForecasts.mockResolvedValue([]);
    mockHistoricalForecasts.mockResolvedValue([
      { rideName: "Matterhorn", landName: "Fantasyland", avgWait: 50, peakWait: 80 },
    ]);

    const response = await POST(request({
      date: "2027-01-01",
      messages: [{ role: "user", content: "Is this date busy?" }],
    }));

    await response.text();
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("historical same-weekday averages for the selected date");
    expect(prompt).toContain("Matterhorn (Fantasyland): avg ~50 min, peak ~80 min");
  });

  it("rejects impossible dates before querying data sources", async () => {
    const response = await POST(request({
      date: "2026-02-31",
      messages: [{ role: "user", content: "test" }],
    }));

    expect(response.status).toBe(400);
    expect(mockCrowdScore).not.toHaveBeenCalled();
    expect(mockMlForecasts).not.toHaveBeenCalled();
  });
});
