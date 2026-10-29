"use client";

import { useState, useRef, useEffect } from "react";
import { format, addDays, subDays, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { parkDateKey } from "@/lib/park-time";

type Props = {
  value: string; // yyyy-MM-dd
  onChange: (value: string) => void;
  label?: string;
};

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function monthStartFromValue(value: string): Date {
  const [y, m] = value.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export default function DisneyDatePicker({ value, onChange, label }: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => monthStartFromValue(value));
  const containerRef = useRef<HTMLDivElement>(null);

  // viewMonth follows `value` but is also moved by the prev/next buttons, so it
  // is state seeded from a prop. Resetting it during render when the prop
  // changes is React's documented pattern; an effect that set it would render
  // the old month once before correcting itself.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setViewMonth(monthStartFromValue(value));
  }

  const date = parseLocalDate(value);
  const today = parkDateKey(new Date());

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
    <div ref={containerRef} className="relative min-w-[15rem] select-none">
      {label && (
        <p className="control-label mb-2">{label}</p>
      )}

      <div className="flex items-center gap-1 rounded-lg border border-space-700 bg-space-card px-2 py-2 shadow-sm">
        <svg className="ml-1 shrink-0 text-warm-500" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M8 2v4M16 2v4M3 10h18" />
        </svg>
          <button
            type="button"
            onClick={prevDay}
            className="shrink-0 rounded-md p-1.5 text-warm-500 transition-colors hover:bg-space-800 hover:text-warm-900"
            aria-label="Previous day"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setCalendarOpen((o) => !o)}
            aria-label={`Change date, currently ${format(date, "MMMM d, yyyy")}`}
            aria-expanded={calendarOpen}
            aria-haspopup="dialog"
            className="flex flex-1 flex-col items-start gap-0 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-space-800"
          >
            <span className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-warm-500">
              {format(date, "EEEE")}
            </span>
            <span className="text-sm font-medium leading-snug text-warm-900">
              {format(date, "MMM d, yyyy")}
            </span>
          </button>

          <button
            type="button"
            onClick={nextDay}
            className="shrink-0 rounded-md p-1.5 text-warm-500 transition-colors hover:bg-space-800 hover:text-warm-900"
            aria-label="Next day"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
      </div>

      <AnimatePresence>
        {calendarOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute z-50 mt-2 w-64 rounded-xl border border-space-700 bg-space-card p-4 shadow-md"
          >
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="rounded-md p-1 text-warm-500 transition-colors hover:bg-space-800 hover:text-warm-900"
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
                className="rounded-md p-1 text-warm-500 transition-colors hover:bg-space-800 hover:text-warm-900"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-7 mb-1">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d} className="text-center text-[10px] text-warm-600 font-medium py-1">
                  {d}
                </div>
              ))}
            </div>

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
                        ? "bg-warm-900 text-space-900"
                        : isToday
                          ? "text-warm-900 ring-1 ring-warm-500 hover:bg-space-800"
                          : "text-warm-800 hover:bg-space-800",
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
