"use client";

import { useState, useRef, useEffect } from "react";
import { format, addDays, subDays, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

type Props = {
  value: string; // yyyy-MM-dd
  onChange: (value: string) => void;
  label?: string;
};

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default function DisneyDatePicker({ value, onChange, label }: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const [y, m] = value.split("-").map(Number);
    return new Date(y, m - 1, 1);
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const date = parseLocalDate(value);
  const today = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    const [y, m] = value.split("-").map(Number);
    setViewMonth(new Date(y, m - 1, 1));
  }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setCalendarOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function prevDay() {
    onChange(format(subDays(date, 1), "yyyy-MM-dd"));
  }

  function nextDay() {
    onChange(format(addDays(date, 1), "yyyy-MM-dd"));
  }

  function selectDay(d: Date) {
    onChange(format(d, "yyyy-MM-dd"));
    setCalendarOpen(false);
  }

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = getDay(monthStart);

  return (
    <div ref={containerRef} className="relative select-none">
      {label && (
        <p className="text-xs text-warm-700 font-medium uppercase tracking-wide mb-2">{label}</p>
      )}

      {/* Ticket stub */}
      <div className="flex rounded-xl overflow-hidden shadow-lg" style={{ border: "1px solid rgba(240,192,96,0.25)" }}>
        {/* Orange stub strip */}
        <div
          className="w-9 bg-orange-500 flex items-center justify-center shrink-0"
          style={{ borderRight: "2px dashed rgba(255,255,255,0.35)" }}
        >
          <span
            className="text-white text-[8px] font-black tracking-widest"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            ADMIT ONE
          </span>
        </div>

        {/* Main body */}
        <div className="bg-space-card flex-1 flex items-center gap-1 px-2 py-2.5">
          <button
            type="button"
            onClick={prevDay}
            className="text-orange-400 hover:text-orange-300 transition-colors p-1.5 rounded-lg hover:bg-white/5 shrink-0"
            aria-label="Previous day"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setCalendarOpen((o) => !o)}
            className="flex-1 flex flex-col items-center gap-0 py-0.5 rounded-lg hover:bg-white/5 transition-colors px-1"
          >
            <span className="text-[9px] text-warm-600 tracking-[0.18em] uppercase font-semibold">
              Disneyland Resort
            </span>
            <span className="text-base font-bold text-warm-900 leading-snug">
              {format(date, "MMM d, yyyy")}
            </span>
            <span className="text-[10px] text-warm-600">
              {format(date, "EEEE")}
            </span>
          </button>

          <button
            type="button"
            onClick={nextDay}
            className="text-orange-400 hover:text-orange-300 transition-colors p-1.5 rounded-lg hover:bg-white/5 shrink-0"
            aria-label="Next day"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Calendar popup */}
      <AnimatePresence>
        {calendarOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute z-50 mt-2 bg-space-card rounded-2xl shadow-2xl p-4 w-64"
            style={{ border: "1px solid rgba(240,192,96,0.2)" }}
          >
            {/* Month nav */}
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="text-orange-400 hover:text-orange-300 p-1 rounded-lg hover:bg-white/5 transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <span className="text-sm font-semibold text-warm-900">
                {format(viewMonth, "MMMM yyyy")}
              </span>
              <button
                type="button"
                onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="text-orange-400 hover:text-orange-300 p-1 rounded-lg hover:bg-white/5 transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 mb-1">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d} className="text-center text-[10px] text-warm-600 font-medium py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: startPad }).map((_, i) => (
                <div key={`pad-${i}`} />
              ))}
              {days.map((d) => {
                const iso = format(d, "yyyy-MM-dd");
                const isSelected = iso === value;
                const isToday = iso === today;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => selectDay(d)}
                    className={[
                      "aspect-square rounded-lg text-xs font-medium transition-colors flex items-center justify-center",
                      isSelected
                        ? "bg-orange-500 text-white"
                        : isToday
                          ? "text-orange-400 ring-1 ring-orange-400 hover:bg-orange-500/10"
                          : "text-warm-800 hover:bg-white/8",
                    ].join(" ")}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
