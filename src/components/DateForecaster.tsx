"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import CrowdMeter from "./CrowdMeter";

type Forecast = {
  date: string;
  crowdScore: number | null;
  crowdNarration: string | null;
  forecasts: { rideId: number; rideName: string; landName: string; predictedWait: number }[];
  source: string;
  dataQualityOk: boolean;
};

export default function DateForecaster() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/forecast?date=${date}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-8">
      <form onSubmit={handleSubmit} className="flex gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="date" className="text-sm text-warm-700 font-medium">
            Select a date
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-cream-200 rounded-xl px-4 py-2.5 text-warm-900 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
          />
        </div>
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
            className="text-red-500 text-sm"
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
            {!result.dataQualityOk && (
              <div className="text-xs text-warm-700 bg-cream-200 border border-cream-200 rounded-lg px-3 py-2">
                Data collection has had recent issues — forecasts may be stale.
              </div>
            )}

            {result.crowdScore !== null ? (
              <>
                <CrowdMeter score={result.crowdScore} />
                {result.crowdNarration && (
                  <div className="max-w-lg bg-white border border-cream-200 rounded-2xl px-6 py-4 shadow-sm text-sm text-warm-900 leading-relaxed">
                    {result.crowdNarration}
                  </div>
                )}
                <a
                  href={`/wait-times?date=${date}`}
                  className="text-sm text-orange-500 hover:text-orange-600 font-medium"
                >
                  See per-ride predictions →
                </a>
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
