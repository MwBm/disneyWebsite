"use client";

import { useState, useEffect, useCallback } from "react";
import { format, parseISO } from "date-fns";

type DayScore = {
  date: string;
  crowdScore: number | null;
  source: "ml" | "historical" | "groq" | null;
  tier: number | null;
  specialEvent: string | null;
  isHoliday: boolean;
};

type WeatherDay = {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  precipProb: number;
};

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function crowdColor(score: number | null): string {
  if (score === null) return "#1e2235";
  if (score <= 30) return "#22c55e";
  if (score <= 55) return "#f0c060";
  if (score <= 75) return "#fb923c";
  return "#ef4444";
}

function crowdLabel(score: number | null): string {
  if (score === null) return "No data";
  if (score <= 30) return "Low";
  if (score <= 55) return "Moderate";
  if (score <= 75) return "Busy";
  return "Very Busy";
}

function crowdBgOpacity(score: number | null): number {
  if (score === null) return 0;
  if (score <= 30) return 0.12;
  if (score <= 55) return 0.15;
  if (score <= 75) return 0.18;
  return 0.22;
}

function weatherEmoji(code: number): string {
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

function weatherLabel(code: number): string {
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

const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <path d="M16 2v4M8 2v4M3 10h18"/>
    <circle cx="8" cy="16" r="1" fill="currentColor"/>
    <circle cx="12" cy="16" r="1" fill="currentColor"/>
    <circle cx="16" cy="16" r="1" fill="currentColor"/>
  </svg>
);

const ChevronLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6"/>
  </svg>
);

const ChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18l6-6-6-6"/>
  </svg>
);

const ArrowRight = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
);

function SourceBadge({ source }: { source: DayScore["source"] }) {
  if (!source) return null;
  const cfg = {
    ml: { label: "ML", color: "#818cf8" },
    historical: { label: "Hist", color: "#94a3b8" },
    groq: { label: "AI", color: "#f0c060" },
  }[source];
  return (
    <span
      className="text-[0.55rem] font-semibold uppercase tracking-wider px-1 py-0.5 rounded"
      style={{ color: cfg.color, background: `${cfg.color}18`, border: `1px solid ${cfg.color}30` }}
    >
      {cfg.label}
    </span>
  );
}

const TIER_COLORS = ["#94a3b8", "#86efac", "#fde68a", "#fb923c", "#f87171", "#ef4444"];

function TierBadge({ tier }: { tier: number | null }) {
  if (tier === null) return null;
  const color = TIER_COLORS[Math.min(tier, 5)];
  return (
    <span
      className="text-[0.5rem] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
      style={{ color, background: `${color}18`, border: `1px solid ${color}30` }}
    >
      T{tier}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = crowdColor(score);
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-warm-500">Crowd Score</span>
        <span className="text-sm font-semibold" style={{ color }}>{score}/100</span>
      </div>
      <div className="h-2 rounded-full bg-space-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${score}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            boxShadow: `0 0 8px ${color}60`,
          }}
        />
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [days, setDays] = useState<DayScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DayScore | null>(null);
  const [weather, setWeather] = useState<Map<string, WeatherDay>>(new Map());

  useEffect(() => {
    fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=33.8121&longitude=-117.9190" +
      "&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles&forecast_days=16"
    )
      .then(r => r.json())
      .then(data => {
        const map = new Map<string, WeatherDay>();
        const dates: string[] = data.daily?.time ?? [];
        dates.forEach((date: string, i: number) => {
          map.set(date, {
            date,
            weatherCode: data.daily.weathercode[i],
            tempMax: Math.round(data.daily.temperature_2m_max[i]),
            tempMin: Math.round(data.daily.temperature_2m_min[i]),
            precipProb: data.daily.precipitation_probability_max[i],
          });
        });
        setWeather(map);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setSelected(null);
    try {
      const res = await fetch(`/api/calendar?year=${y}&month=${m}`);
      const data = await res.json();
      setDays(data.days ?? []);
    } catch {
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(year, month);
  }, [year, month, load]);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  const firstDayOfMonth = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;

  const cells: (DayScore | null)[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDayOfMonth + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push(null);
    } else {
      const key = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      cells.push(days.find((d) => d.date === key) ?? { date: key, crowdScore: null, source: null, tier: null, specialEvent: null, isHoliday: false });
    }
  }

  const todayStr = format(today, "yyyy-MM-dd");

  // Month stats
  const scoredDays = days.filter(d => d.crowdScore !== null);
  const avgScore = scoredDays.length
    ? Math.round(scoredDays.reduce((a, b) => a + (b.crowdScore ?? 0), 0) / scoredDays.length)
    : null;
  const bestDay = scoredDays.length
    ? scoredDays.reduce((a, b) => (b.crowdScore ?? 100) < (a.crowdScore ?? 100) ? b : a)
    : null;
  const worstDay = scoredDays.length
    ? scoredDays.reduce((a, b) => (b.crowdScore ?? 0) > (a.crowdScore ?? 0) ? b : a)
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-orange-400 shrink-0"
          style={{ background: "rgba(240,192,96,0.07)", border: "1px solid rgba(240,192,96,0.14)" }}
        >
          <CalendarIcon />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-warm-900 tracking-tight">Crowd Calendar</h1>
          <p className="text-warm-700 text-sm mt-0.5">
            Monthly view of predicted park busyness — click any day for details.
          </p>
        </div>
      </div>

      {/* Month summary stats */}
      {!loading && avgScore !== null && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Monthly Average", value: `${avgScore}/100`, sub: crowdLabel(avgScore), color: crowdColor(avgScore) },
            { label: "Best Day", value: bestDay ? format(parseISO(bestDay.date), "EEE, MMM d") : "—", sub: bestDay ? `${bestDay.crowdScore}/100 · ${crowdLabel(bestDay.crowdScore)}` : "", color: crowdColor(bestDay?.crowdScore ?? null) },
            { label: "Busiest Day", value: worstDay ? format(parseISO(worstDay.date), "EEE, MMM d") : "—", sub: worstDay ? `${worstDay.crowdScore}/100 · ${crowdLabel(worstDay.crowdScore)}` : "", color: crowdColor(worstDay?.crowdScore ?? null) },
          ].map(({ label, value, sub, color }) => (
            <div
              key={label}
              className="bg-space-card border border-space-700 rounded-xl p-4 neon"
              style={{ borderColor: `${color}22` }}
            >
              <p className="text-warm-500 text-xs uppercase tracking-widest mb-1">{label}</p>
              <p className="font-semibold text-warm-900 text-sm leading-tight">{value}</p>
              {sub && <p className="text-xs mt-0.5" style={{ color }}>{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Calendar card */}
      <div className="bg-space-card border border-space-700 rounded-2xl overflow-hidden neon neon-gold">
        {/* Month nav */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-space-700">
          <button
            onClick={prevMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-warm-700 hover:text-orange-400 hover:bg-space-800 transition-colors"
          >
            <ChevronLeft />
          </button>
          <div className="text-center">
            <p className="font-display italic text-orange-400 text-xl leading-none tracking-tight">
              {format(new Date(year, month - 1), "MMMM")}
            </p>
            <p className="text-warm-500 text-xs tracking-widest mt-0.5">{year}</p>
          </div>
          <button
            onClick={nextMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-warm-700 hover:text-orange-400 hover:bg-space-800 transition-colors"
          >
            <ChevronRight />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-space-700">
          {DAYS_OF_WEEK.map((d) => (
            <div key={d} className="py-2 text-center text-[0.65rem] font-medium uppercase tracking-widest text-warm-500">
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="h-20 p-2 border-b border-r border-space-700/50 last:border-r-0">
                <div className="w-full h-full rounded-lg bg-space-800 animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((cell, i) => {
              const isToday = cell?.date === todayStr;
              const isSelected = cell?.date === selected?.date;
              const score = cell?.crowdScore ?? null;
              const color = crowdColor(score);
              const bgOpacity = crowdBgOpacity(score);
              const col = i % 7;
              const isLastCol = col === 6;
              const row = Math.floor(i / 7);
              const totalRows = cells.length / 7;
              const isLastRow = row === totalRows - 1;

              const wx = cell ? weather.get(cell.date) : undefined;

              return (
                <div
                  key={i}
                  onClick={() => cell && setSelected(isSelected ? null : cell)}
                  className={`relative h-20 p-2.5 transition-all duration-150 ${
                    !isLastCol ? "border-r border-space-700/40" : ""
                  } ${!isLastRow ? "border-b border-space-700/40" : ""} ${
                    cell ? "cursor-pointer" : ""
                  }`}
                  style={{
                    background: cell
                      ? isSelected
                        ? `${color}28`
                        : `${color}${Math.round(bgOpacity * 255).toString(16).padStart(2, "0")}`
                      : undefined,
                    boxShadow: isSelected ? `inset 0 0 0 1.5px ${color}60` : undefined,
                  }}
                  onMouseEnter={e => {
                    if (cell && !isSelected) {
                      (e.currentTarget as HTMLDivElement).style.background = `${color}20`;
                    }
                  }}
                  onMouseLeave={e => {
                    if (cell && !isSelected) {
                      (e.currentTarget as HTMLDivElement).style.background = `${color}${Math.round(bgOpacity * 255).toString(16).padStart(2, "0")}`;
                    }
                  }}
                >
                  {cell && (
                    <div className="flex flex-col h-full">
                      {/* Top row: day number + source badge */}
                      <div className="flex items-start justify-between">
                        <span
                          className={`text-xs font-semibold leading-none ${
                            isToday ? "text-orange-400" : isSelected ? "text-warm-900" : "text-warm-700"
                          }`}
                        >
                          {parseInt(cell.date.slice(8))}
                        </span>
                        {cell.source && <SourceBadge source={cell.source} />}
                      </div>

                      {/* Score + label in center */}
                      {score !== null ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-0.5">
                          <span
                            className="text-lg font-bold leading-none tabular-nums"
                            style={{
                              color,
                              opacity: cell.source === "groq" ? 0.7 : 1,
                              textShadow: cell.source !== "groq" ? `0 0 12px ${color}60` : undefined,
                            }}
                          >
                            {score}
                          </span>
                          <span
                            className="text-[0.6rem] font-medium uppercase tracking-wide leading-none"
                            style={{ color, opacity: cell.source === "groq" ? 0.55 : 0.75 }}
                          >
                            {crowdLabel(score)}
                          </span>
                        </div>
                      ) : (
                        <div className="flex-1 flex items-center justify-center">
                          <span className="text-[0.6rem] text-warm-500/40 uppercase tracking-wide">—</span>
                        </div>
                      )}

                      {/* Bottom row: tier badge + weather + indicators */}
                      {(cell.tier !== null || cell.specialEvent || cell.isHoliday || wx) && (
                        <div className="flex items-end justify-between gap-1 mt-0.5">
                          <TierBadge tier={cell.tier} />
                          <div className="flex items-center gap-0.5">
                            {wx && (
                              <span
                                className="text-[0.65rem] leading-none"
                                title={`${weatherLabel(wx.weatherCode)} · ${wx.tempMax}°/${wx.tempMin}°F`}
                              >
                                {weatherEmoji(wx.weatherCode)}
                              </span>
                            )}
                            {cell.isHoliday && (
                              <span
                                className="text-[0.45rem] font-bold leading-none"
                                style={{ color: "#60a5fa" }}
                                title="US Holiday"
                              >
                                ★
                              </span>
                            )}
                            {cell.specialEvent && (
                              <span
                                className="text-[0.45rem] font-medium leading-none"
                                style={{ color: "#f0c060", opacity: 0.8 }}
                                title={`Disney Event: ${cell.specialEvent}`}
                              >
                                ♦
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Today ring */}
                  {isToday && (
                    <div
                      className="absolute inset-1 rounded-lg pointer-events-none"
                      style={{ border: "1.5px solid rgba(240,192,96,0.5)" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected day detail */}
      {selected && (
        <div
          className="bg-space-card border rounded-2xl p-5 transition-all duration-200"
          style={{ borderColor: `${crowdColor(selected.crowdScore)}40` }}
        >
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1 min-w-0">
              {/* Date heading */}
              <div className="flex items-center gap-2.5 mb-4">
                <div
                  className="w-1.5 h-8 rounded-full shrink-0"
                  style={{ background: crowdColor(selected.crowdScore), boxShadow: `0 0 8px ${crowdColor(selected.crowdScore)}80` }}
                />
                <div>
                  <p className="text-warm-900 font-semibold leading-tight">
                    {format(parseISO(selected.date), "EEEE, MMMM d, yyyy")}
                  </p>
                  <p className="text-xs text-warm-500 mt-0.5 flex items-center gap-1.5">
                    <SourceBadge source={selected.source} />
                    {selected.source === "ml" && "ML model prediction"}
                    {selected.source === "historical" && `Based on typical ${format(parseISO(selected.date), "EEEE")} patterns`}
                    {selected.source === "groq" && "AI estimate — limited historical data"}
                    {!selected.source && "No data available"}
                    {selected.tier !== null && <TierBadge tier={selected.tier} />}
                  </p>
                  {selected.isHoliday && (
                    <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "#60a5fa" }}>
                      <span>★</span>
                      <span>US Holiday</span>
                    </p>
                  )}
                  {selected.specialEvent && (
                    <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "#f0c060" }}>
                      <span>♦</span>
                      <span>Disney Event: {selected.specialEvent}</span>
                    </p>
                  )}
                  {(() => {
                    const wx = weather.get(selected.date);
                    if (!wx) return null;
                    return (
                      <p className="text-xs mt-1 flex items-center gap-1.5 text-warm-600">
                        <span>{weatherEmoji(wx.weatherCode)}</span>
                        <span>{weatherLabel(wx.weatherCode)}</span>
                        <span className="text-warm-700">·</span>
                        <span>{wx.tempMax}°<span className="text-warm-500">/{wx.tempMin}°F</span></span>
                        {wx.precipProb > 0 && (
                          <>
                            <span className="text-warm-700">·</span>
                            <span style={{ color: "#60a5fa" }}>{wx.precipProb}% rain</span>
                          </>
                        )}
                      </p>
                    );
                  })()}
                </div>
              </div>

              {/* Score bar */}
              {selected.crowdScore !== null && (
                <ScoreBar score={selected.crowdScore} />
              )}

              {/* Score breakdown */}
              {selected.crowdScore !== null && (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[
                    { label: "Low", range: "≤30", color: "#22c55e", active: selected.crowdScore <= 30 },
                    { label: "Moderate", range: "31–55", color: "#f0c060", active: selected.crowdScore > 30 && selected.crowdScore <= 55 },
                    { label: "Busy", range: "56–75", color: "#fb923c", active: selected.crowdScore > 55 && selected.crowdScore <= 75 },
                    { label: "Very Busy", range: "76+", color: "#ef4444", active: selected.crowdScore > 75 },
                  ].map(({ label, range, color, active }) => (
                    <div
                      key={label}
                      className="rounded-lg p-2 text-center transition-all"
                      style={{
                        background: active ? `${color}18` : "transparent",
                        border: `1px solid ${active ? color + "40" : "transparent"}`,
                      }}
                    >
                      <p className="text-[0.6rem] uppercase tracking-wide" style={{ color: active ? color : "#4a5568" }}>{label}</p>
                      <p className="text-[0.65rem] mt-0.5" style={{ color: active ? color + "aa" : "#2d3748" }}>{range}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CTA */}
            <a
              href={`/?date=${selected.date}`}
              className="shrink-0 flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl text-orange-400 hover:text-orange-300 transition-all group"
              style={{ background: "rgba(240,192,96,0.06)", border: "1px solid rgba(240,192,96,0.15)" }}
            >
              <span className="text-xs font-medium">Full Forecast</span>
              <span className="group-hover:translate-x-0.5 transition-transform">
                <ArrowRight />
              </span>
            </a>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 justify-center pb-2">
        {[
          { label: "Low (≤30)", color: "#22c55e" },
          { label: "Moderate (31–55)", color: "#f0c060" },
          { label: "Busy (56–75)", color: "#fb923c" },
          { label: "Very Busy (76+)", color: "#ef4444" },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color, opacity: 0.8 }} />
            <span className="text-xs text-warm-500">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-space-700" />
          <span className="text-xs text-warm-500">No data</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="text-[0.6rem] font-semibold uppercase tracking-wider px-1 py-0.5 rounded"
            style={{ color: "#f0c060", background: "#f0c06018", border: "1px solid #f0c06030" }}
          >
            AI
          </span>
          <span className="text-xs text-warm-500 italic">AI estimate</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold" style={{ color: "#60a5fa" }}>★</span>
          <span className="text-xs text-warm-500">US Holiday</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm" style={{ color: "#f0c060" }}>♦</span>
          <span className="text-xs text-warm-500">Disney Ticketed Event (after-hours paid event)</span>
        </div>
      </div>
    </div>
  );
}
