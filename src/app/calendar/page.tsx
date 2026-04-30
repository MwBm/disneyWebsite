"use client";

import { useState, useEffect, useCallback } from "react";
import { format, parseISO } from "date-fns";

type DayScore = {
  date: string;
  crowdScore: number | null;
  source: "ml" | "historical" | "groq" | null;
};

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function crowdColor(score: number | null): string {
  if (score === null) return "transparent";
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

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [days, setDays] = useState<DayScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DayScore | null>(null);

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

  // Build calendar grid
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;

  const cells: (DayScore | null)[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDayOfMonth + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push(null);
    } else {
      const key = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      cells.push(days.find((d) => d.date === key) ?? { date: key, crowdScore: null, source: null });
    }
  }

  const todayStr = format(today, "yyyy-MM-dd");

  return (
    <div className="flex flex-col gap-8">
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
            Monthly view of predicted park busyness — plan your visit at a glance.
          </p>
        </div>
      </div>

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
              <div key={i} className="aspect-square p-2 border-b border-r border-space-700/50 last:border-r-0">
                <div className="w-full h-full rounded-lg bg-space-800 animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((cell, i) => {
              const isToday = cell?.date === todayStr;
              const isSelected = cell?.date === selected?.date;
              const color = crowdColor(cell?.crowdScore ?? null);
              const col = i % 7;
              const isLastCol = col === 6;
              const row = Math.floor(i / 7);
              const totalRows = cells.length / 7;
              const isLastRow = row === totalRows - 1;

              return (
                <div
                  key={i}
                  onClick={() => cell && setSelected(isSelected ? null : cell)}
                  className={`relative aspect-square p-1.5 transition-all duration-150 ${
                    !isLastCol ? "border-r border-space-700/40" : ""
                  } ${!isLastRow ? "border-b border-space-700/40" : ""} ${
                    cell ? "cursor-pointer hover:bg-space-800/50" : ""
                  } ${isSelected ? "bg-space-800" : ""}`}
                >
                  {cell && (
                    <>
                      {/* Day number */}
                      <span
                        className={`text-xs font-medium leading-none ${
                          isToday ? "text-orange-400" : "text-warm-700"
                        } ${isSelected ? "text-warm-900" : ""}`}
                      >
                        {parseInt(cell.date.slice(8))}
                      </span>

                      {/* Color dot — dimmer for Groq estimates */}
                      {cell.crowdScore !== null && (
                        <div
                          className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor: color,
                            opacity: cell.source === "groq" ? 0.45 : 1,
                            boxShadow: cell.source !== "groq" ? `0 0 4px ${color}80` : undefined,
                          }}
                        />
                      )}

                      {/* Today ring */}
                      {isToday && (
                        <div className="absolute inset-1 rounded-lg pointer-events-none"
                          style={{ border: "1px solid rgba(240,192,96,0.4)" }} />
                      )}
                    </>
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
          className="bg-space-card border border-space-700 rounded-2xl p-5 flex items-center justify-between"
          style={{ borderColor: `${crowdColor(selected.crowdScore)}40` }}
        >
          <div>
            <p className="text-warm-900 font-medium">
              {format(parseISO(selected.date), "EEEE, MMMM d, yyyy")}
            </p>
            <p className="text-sm mt-0.5" style={{ color: crowdColor(selected.crowdScore) }}>
              {crowdLabel(selected.crowdScore)}
              {selected.crowdScore !== null && ` — ${selected.crowdScore}/100`}
            </p>
            {selected.source === "historical" && (
              <p className="text-xs text-warm-500 mt-1">Based on typical {format(parseISO(selected.date), "EEEE")} patterns</p>
            )}
            {selected.source === "groq" && (
              <p className="text-xs text-warm-500 mt-1 italic">AI estimate — no historical data for this day of week yet</p>
            )}
          </div>
          <a
            href={`/?date=${selected.date}`}
            className="text-xs font-medium text-orange-400 hover:text-orange-500 flex items-center gap-1 transition-colors shrink-0 ml-4"
          >
            Full forecast
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 justify-center">
        {[
          { label: "Low (≤30)", color: "#22c55e" },
          { label: "Moderate (31–55)", color: "#f0c060" },
          { label: "Busy (56–75)", color: "#fb923c" },
          { label: "Very Busy (76+)", color: "#ef4444" },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-xs text-warm-500">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-space-700" />
          <span className="text-xs text-warm-500">No data</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-warm-500 opacity-45" />
          <span className="text-xs text-warm-500 italic">AI estimate</span>
        </div>
      </div>
    </div>
  );
}
