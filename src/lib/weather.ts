/**
 * Single source of truth for Anaheim weather.
 *
 * The calendar page used to fetch Open-Meteo directly from the browser with a
 * second set of coordinates (33.8121, -117.9190), a second response parser and
 * a second WeatherDay type. Two coordinates for one theme park is one too many,
 * so the fetch lives here and /api/weather serves it.
 */
export const ANAHEIM_LAT = 33.8366;
export const ANAHEIM_LON = -117.9143;

/** Open-Meteo only forecasts this far out; beyond it we use climatology. */
export const FORECAST_HORIZON_DAYS = 16;

/** precipMm at or above this reads as a rainy day. */
export const RAINY_PRECIP_MM = 2.5;

// Climatological monthly means for Anaheim (°F high, °F low, precip mm/day)
// Source: NOAA 30-year normals. Used when date > 16 days out (Open-Meteo forecast limit).
const ANAHEIM_MONTHLY_NORMALS: Record<number, { tempHigh: number; tempLow: number; precipMm: number }> = {
  1:  { tempHigh: 68, tempLow: 48, precipMm: 2.5 },
  2:  { tempHigh: 69, tempLow: 49, precipMm: 2.5 },
  3:  { tempHigh: 72, tempLow: 52, precipMm: 1.5 },
  4:  { tempHigh: 76, tempLow: 55, precipMm: 0.5 },
  5:  { tempHigh: 80, tempLow: 60, precipMm: 0.1 },
  6:  { tempHigh: 86, tempLow: 64, precipMm: 0.0 },
  7:  { tempHigh: 93, tempLow: 69, precipMm: 0.0 },
  8:  { tempHigh: 93, tempLow: 70, precipMm: 0.1 },
  9:  { tempHigh: 89, tempLow: 67, precipMm: 0.3 },
  10: { tempHigh: 81, tempLow: 61, precipMm: 0.5 },
  11: { tempHigh: 73, tempLow: 53, precipMm: 1.5 },
  12: { tempHigh: 67, tempLow: 47, precipMm: 2.0 },
};

/** WMO weather codes used by Open-Meteo. */
export const WMO_CLEAR = 0;
export const WMO_RAIN = 61;

export type WeatherDay = {
  date: string;
  tempHigh: number;
  tempLow: number;
  precipMm: number;
  isRainy: boolean;
  /** WMO code; drives the icon. */
  weatherCode: number;
  /** Percentage chance of precipitation, 0–100. */
  precipProb: number;
};

export async function fetchWeatherForecast(startDate: string, endDate: string): Promise<Map<string, WeatherDay>> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${ANAHEIM_LAT}&longitude=${ANAHEIM_LON}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,precipitation_probability_max` +
    `&temperature_unit=fahrenheit` +
    `&precipitation_unit=mm` +
    `&timezone=America%2FLos_Angeles` +
    `&start_date=${startDate}&end_date=${endDate}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);

  const data = await res.json() as {
    daily?: {
      time?: string[];
      temperature_2m_max?: (number | null)[];
      temperature_2m_min?: (number | null)[];
      precipitation_sum?: (number | null)[];
      weathercode?: (number | null)[];
      precipitation_probability_max?: (number | null)[];
    };
  };

  const map = new Map<string, WeatherDay>();
  const times = data.daily?.time ?? [];
  for (let i = 0; i < times.length; i++) {
    const precipMm = data.daily?.precipitation_sum?.[i] ?? 0;
    map.set(times[i], {
      date: times[i],
      tempHigh: Math.round(data.daily?.temperature_2m_max?.[i] ?? 75),
      tempLow: Math.round(data.daily?.temperature_2m_min?.[i] ?? 55),
      precipMm,
      isRainy: precipMm >= RAINY_PRECIP_MM,
      weatherCode: data.daily?.weathercode?.[i] ?? WMO_CLEAR,
      precipProb: data.daily?.precipitation_probability_max?.[i] ?? 0,
    });
  }
  return map;
}

export function climatologicalWeather(dateStr: string): WeatherDay {
  const month = parseInt(dateStr.slice(5, 7), 10);
  const n = ANAHEIM_MONTHLY_NORMALS[month];

  // A malformed date string would index the record with NaN and crash on the
  // non-null assertion this used to carry. Fall back to a mild default day.
  if (!n) {
    return {
      date: dateStr, tempHigh: 75, tempLow: 55, precipMm: 0,
      isRainy: false, weatherCode: WMO_CLEAR, precipProb: 0,
    };
  }

  const isRainy = n.precipMm >= RAINY_PRECIP_MM;
  return {
    date: dateStr,
    tempHigh: n.tempHigh,
    tempLow: n.tempLow,
    precipMm: n.precipMm,
    isRainy,
    // Climatology has no forecast code; derive one so the icon stays honest.
    weatherCode: isRainy ? WMO_RAIN : WMO_CLEAR,
    precipProb: Math.round(Math.min(n.precipMm / RAINY_PRECIP_MM, 1) * 100),
  };
}

export function weatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 55) return "🌦️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌦️";
  return "⛈️";
}

export function weatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Foggy";
  if (code <= 55) return "Drizzle";
  if (code <= 67) return "Rainy";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  return "Thunderstorm";
}
