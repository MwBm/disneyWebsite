"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import CrowdMeter from "./CrowdMeter";
import DisneyDatePicker from "./DisneyDatePicker";
import ParkPicker from "./ParkPicker";
import { parkDateKey } from "@/lib/park-time";
import { DISNEYLAND_PARK_ID, type ParkId } from "@/lib/parks";
import type { RideDayForecast } from "@/lib/forecast-queries";

type Forecast = {
  date: string;
  crowdScore: number | null;
  crowdNarration: string | null;
  forecasts: RideDayForecast[];
  source: string;
  dataQualityOk: boolean;
  lastCollectedAt: string | null;
  parkId: ParkId;
};

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function DateForecaster() {
  const [date, setDate] = useState(() => parkDateKey(new Date()));
  const [parkId, setParkId] = useState<ParkId>(DISNEYLAND_PARK_ID);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [narration, setNarration] = useState<string | null>(null);
  const [narrationLoading, setNarrationLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setNarration(null);
    try {
      const res = await fetch(`/api/forecast?date=${date}&park=${parkId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function loadNarration() {
    setNarrationLoading(true);
    try {
      const res = await fetch(`/api/forecast/narration?date=${date}&park=${parkId}`);
      const data = await res.json();
      if (res.ok) setNarration(typeof data.narration === "string" ? data.narration : null);
    } finally {
      setNarrationLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-8">
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end justify-center">
        <ParkPicker value={parkId} onChange={(nextParkId) => {
          setParkId(nextParkId);
          setResult(null);
          setNarration(null);
        }} />
        <DisneyDatePicker value={date} onChange={setDate} label="Select a date" />
        <button
          type="submit"
          disabled={loading}
          className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : "Forecast"}
        </button>
      </form>

      <AnimatePresence mode="wait">
        {error && (
          <motion.p
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-red-400 text-sm"
          >
            {error}
          </motion.p>
        )}

        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-6 w-full"
          >
            {result.lastCollectedAt && (
              <p className="text-xs text-warm-500">
                Data updated {timeAgo(result.lastCollectedAt)}
              </p>
            )}
            {!result.dataQualityOk && (
              <div className="text-xs text-warm-700 bg-space-card border border-space-700 rounded-lg px-3 py-2">
                Data collection has had recent issues — forecasts may be stale.
              </div>
            )}

            {result.source === "historical" && (
              <p className="text-xs text-warm-500 bg-space-card border border-space-700 rounded-lg px-3 py-1.5">
                Based on typical {format(parseISO(result.date), "EEEE")} patterns — no ML data for this date yet.
              </p>
            )}

            {result.crowdScore !== null ? (
              <>
                <CrowdMeter score={result.crowdScore} />
                {narration && (
                  <div className="max-w-lg bg-space-card border border-space-700 rounded-2xl px-6 py-4 neon neon-purple text-sm text-warm-900 leading-relaxed">
                    {narration}
                  </div>
                )}
                {!narration && result.source !== "unavailable" && (
                  <button
                    type="button"
                    onClick={loadNarration}
                    disabled={narrationLoading}
                    className="text-xs text-warm-500 hover:text-orange-400 transition-colors disabled:opacity-50"
                  >
                    {narrationLoading ? "Writing planning tip…" : "Add a planning tip"}
                  </button>
                )}
                {result.source !== "groq" && (
                  <a
                    href={`/wait-times?date=${date}&park=${parkId}`}
                    className="text-sm text-orange-400 hover:text-orange-500 font-medium flex items-center gap-1"
                  >
                    See per-ride predictions
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </a>
                )}
              </>
            ) : (
              <p className="text-warm-700 text-sm">
                No forecast data yet for {format(parseISO(date), "MMMM d, yyyy")}. Check back
                after the first data collection runs.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
