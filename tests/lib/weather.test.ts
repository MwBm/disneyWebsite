import {
  ANAHEIM_LAT,
  ANAHEIM_LON,
  RAINY_PRECIP_MM,
  WMO_CLEAR,
  WMO_RAIN,
  climatologicalWeather,
  fetchWeatherForecast,
  weatherEmoji,
  weatherLabel,
} from "@/lib/weather";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function mockOpenMeteo(body: unknown, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("fetchWeatherForecast", () => {
  it("requests the single canonical Anaheim coordinate", async () => {
    mockOpenMeteo({ daily: { time: [] } });
    await fetchWeatherForecast("2026-06-01", "2026-06-02");

    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain(`latitude=${ANAHEIM_LAT}`);
    expect(url).toContain(`longitude=${ANAHEIM_LON}`);
  });

  it("requests the fields the calendar renders", async () => {
    mockOpenMeteo({ daily: { time: [] } });
    await fetchWeatherForecast("2026-06-01", "2026-06-02");

    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain("weathercode");
    expect(url).toContain("precipitation_probability_max");
  });

  it("maps a full response by date", async () => {
    mockOpenMeteo({
      daily: {
        time: ["2026-06-01", "2026-06-02"],
        temperature_2m_max: [82.4, 79.1],
        temperature_2m_min: [61.2, 60.8],
        precipitation_sum: [0, 4.0],
        weathercode: [0, 61],
        precipitation_probability_max: [0, 80],
      },
    });

    const map = await fetchWeatherForecast("2026-06-01", "2026-06-02");
    expect(map.get("2026-06-01")).toEqual({
      date: "2026-06-01", tempHigh: 82, tempLow: 61, precipMm: 0,
      isRainy: false, weatherCode: 0, precipProb: 0,
    });
    expect(map.get("2026-06-02")!.isRainy).toBe(true);
  });

  it("throws on a non-ok response rather than returning an empty map", async () => {
    mockOpenMeteo({}, false, 503);
    await expect(fetchWeatherForecast("2026-06-01", "2026-06-02")).rejects.toThrow("503");
  });

  it("survives a response with the daily block missing entirely", async () => {
    mockOpenMeteo({});
    await expect(fetchWeatherForecast("2026-06-01", "2026-06-02")).resolves.toEqual(new Map());
  });

  it("substitutes defaults for null entries inside an otherwise valid day", async () => {
    mockOpenMeteo({
      daily: {
        time: ["2026-06-01"],
        temperature_2m_max: [null],
        temperature_2m_min: [null],
        precipitation_sum: [null],
        weathercode: [null],
        precipitation_probability_max: [null],
      },
    });

    const day = (await fetchWeatherForecast("2026-06-01", "2026-06-01")).get("2026-06-01")!;
    expect(day.tempHigh).toBe(75);
    expect(day.tempLow).toBe(55);
    expect(day.precipMm).toBe(0);
    expect(day.weatherCode).toBe(WMO_CLEAR);
  });

  it("uses the rainy threshold at its exact boundary", async () => {
    mockOpenMeteo({
      daily: {
        time: ["2026-01-01"], temperature_2m_max: [60], temperature_2m_min: [45],
        precipitation_sum: [RAINY_PRECIP_MM], weathercode: [61],
        precipitation_probability_max: [90],
      },
    });
    const day = (await fetchWeatherForecast("2026-01-01", "2026-01-01")).get("2026-01-01")!;
    expect(day.isRainy).toBe(true);
  });
});

describe("climatologicalWeather", () => {
  it("returns the monthly normal for a valid date", () => {
    const july = climatologicalWeather("2026-07-15");
    expect(july.tempHigh).toBe(93);
    expect(july.isRainy).toBe(false);
    expect(july.weatherCode).toBe(WMO_CLEAR);
  });

  it("derives a rain code for a wet month rather than claiming clear skies", () => {
    expect(climatologicalWeather("2026-01-15").weatherCode).toBe(WMO_RAIN);
  });

  it("covers all twelve months", () => {
    for (let m = 1; m <= 12; m++) {
      const day = climatologicalWeather(`2026-${String(m).padStart(2, "0")}-15`);
      expect(day.tempHigh).toBeGreaterThan(0);
      expect(day.precipProb).toBeGreaterThanOrEqual(0);
      expect(day.precipProb).toBeLessThanOrEqual(100);
    }
  });

  it("falls back instead of throwing on a malformed date string", () => {
    expect(() => climatologicalWeather("2026-13-01")).not.toThrow();
    expect(climatologicalWeather("2026-13-01").tempHigh).toBe(75);
    expect(climatologicalWeather("garbage").tempHigh).toBe(75);
  });
});

describe("weatherEmoji / weatherLabel", () => {
  it.each([
    [0, "Clear"],
    [2, "Partly cloudy"],
    [3, "Overcast"],
    [45, "Foggy"],
    [53, "Drizzle"],
    [61, "Rainy"],
    [71, "Snow"],
    [80, "Showers"],
    [95, "Thunderstorm"],
  ])("labels WMO code %i as %s", (code, label) => {
    expect(weatherLabel(code)).toBe(label);
  });

  it("returns a non-empty emoji for every WMO code in range", () => {
    for (let code = 0; code <= 99; code++) {
      expect(weatherEmoji(code).length).toBeGreaterThan(0);
    }
  });
});
