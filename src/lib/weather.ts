const ANAHEIM_LAT = 33.8366;
const ANAHEIM_LON = -117.9143;

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

export type WeatherDay = {
  date: string;
  tempHigh: number;
  tempLow: number;
  precipMm: number;
  isRainy: boolean;
};

export async function fetchWeatherForecast(startDate: string, endDate: string): Promise<Map<string, WeatherDay>> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${ANAHEIM_LAT}&longitude=${ANAHEIM_LON}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&temperature_unit=fahrenheit` +
    `&precipitation_unit=mm` +
    `&timezone=America%2FLos_Angeles` +
    `&start_date=${startDate}&end_date=${endDate}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);

  const data = await res.json() as {
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_sum: number[];
    };
  };

  const map = new Map<string, WeatherDay>();
  for (let i = 0; i < data.daily.time.length; i++) {
    const precipMm = data.daily.precipitation_sum[i] ?? 0;
    map.set(data.daily.time[i], {
      date: data.daily.time[i],
      tempHigh: data.daily.temperature_2m_max[i] ?? 75,
      tempLow: data.daily.temperature_2m_min[i] ?? 55,
      precipMm,
      isRainy: precipMm >= 2.5,
    });
  }
  return map;
}

export function climatologicalWeather(dateStr: string): WeatherDay {
  const month = parseInt(dateStr.slice(5, 7), 10);
  const n = ANAHEIM_MONTHLY_NORMALS[month]!;
  return { date: dateStr, tempHigh: n.tempHigh, tempLow: n.tempLow, precipMm: n.precipMm, isRainy: n.precipMm >= 2.5 };
}
