/**
 * @jest-environment jsdom
 */

import {
  getStartupData,
  preloadStartupData,
  resetStartupDataForTests,
} from "@/lib/startup-data";

describe("startup data warmup", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetStartupDataForTests();
    global.fetch = jest.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (
        url === "/api/accuracy"
          ? { perRide: [{ parkId: 17, rideId: 295 }] }
          : { url }
      ),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("warms forecasts, calendars, weather, accuracy, and the initial accuracy chart", async () => {
    await preloadStartupData();

    const urls = (global.fetch as jest.Mock).mock.calls.map(([url]) => url as string);
    expect(urls).toEqual(expect.arrayContaining([
      "/api/weather",
      "/api/accuracy",
      "/api/accuracy/rides/295?park=17",
    ]));
    expect(urls.filter((url) => url.startsWith("/api/forecast?"))).toHaveLength(2);
    expect(urls.filter((url) => url.startsWith("/api/calendar?"))).toHaveLength(2);
    expect(getStartupData<{ perRide: unknown[] }>("/api/accuracy")?.perRide).toHaveLength(1);
  });
});
