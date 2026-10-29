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
    <section className="panel p-5 sm:p-7" aria-labelledby="forecast-heading">
      <div className="flex flex-col gap-3 border-b border-space-700 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-3">Crowd forecast</p>
          <h2 id="forecast-heading" className="text-xl font-medium tracking-[-0.025em] text-warm-900">Choose a park day</h2>
        </div>
        <p className="max-w-xs text-sm leading-6 text-warm-700">
          Pick a date to see its predicted crowd level and plan from there.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 grid gap-4 md:grid-cols-[auto_minmax(16rem,1fr)_auto] md:items-end">
        <div className="space-y-2">
          <p className="control-label">Park</p>
          <ParkPicker value={parkId} onChange={(nextParkId) => {
            setParkId(nextParkId);
            setResult(null);
            setNarration(null);
          }} />
        </div>
        <DisneyDatePicker value={date} onChange={setDate} label="Visit date" />
        <button
          type="submit"
          disabled={loading}
          className="primary-action w-full md:w-auto"
        >
          {loading ? "Checking…" : "Check forecast"}
          {!loading && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </button>
      </form>

      <AnimatePresence mode="wait">
        {error && (
          <motion.p
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6 border-t border-space-700 pt-5 text-sm text-red-300"
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
            className="mt-6 flex w-full flex-col items-center gap-6 border-t border-space-700 pt-6"
          >
            {result.lastCollectedAt && (
              <p className="self-start text-xs text-warm-500">
                Data updated {timeAgo(result.lastCollectedAt)}
              </p>
            )}
            {!result.dataQualityOk && (
              <div className="self-start border border-space-700 bg-space-800 px-3 py-2 text-xs text-warm-700">
                Data collection has had recent issues — forecasts may be stale.
              </div>
            )}

            {result.source === "historical" && (
              <p className="self-start border border-space-700 bg-space-800 px-3 py-2 text-xs text-warm-500">
                Based on typical {format(parseISO(result.date), "EEEE")} patterns — no ML data for this date yet.
              </p>
            )}

            {result.crowdScore !== null ? (
              <>
                <CrowdMeter score={result.crowdScore} />
                {narration && (
                  <div className="w-full max-w-lg border-l border-warm-500 pl-4 text-sm leading-7 text-warm-900">
                    {narration}
                  </div>
                )}
                {!narration && result.source !== "unavailable" && (
                  <button
                    type="button"
                    onClick={loadNarration}
                    disabled={narrationLoading}
                    className="text-xs text-warm-500 underline decoration-space-700 underline-offset-4 transition-colors hover:text-warm-900 disabled:opacity-50"
                  >
                    {narrationLoading ? "Writing a planning tip…" : "Add a planning tip"}
                  </button>
                )}
                {result.source !== "groq" && (
                  <a
                    href={`/wait-times?date=${date}&park=${parkId}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-warm-900 underline decoration-warm-500 underline-offset-4 hover:text-white"
                  >
                    See per-ride predictions
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </a>
                )}
              </>
            ) : (
              <p className="self-start text-sm text-warm-700">
                No forecast data yet for {format(parseISO(date), "MMMM d, yyyy")}. Check back
                after the first data collection runs.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
