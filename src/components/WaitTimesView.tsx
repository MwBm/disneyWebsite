"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import DisneyDatePicker from "./DisneyDatePicker";
import RidePredictionTable from "./RidePredictionTable";
import { crowdLabel } from "@/lib/crowd";

type Ride = {
  rideId: number;
  rideName: string;
  landName: string;
  predictedWait: number;
  mlConfidence: number;
};

type ForecastResponse = {
  date: string;
  crowdScore: number | null;
  forecasts: Ride[];
  source: "ml" | "historical" | "groq";
  dataQualityOk: boolean;
  lastCollectedAt: string | null;
};

/** How the numbers were produced, stated plainly rather than implied. */
const SOURCE_NOTES: Record<ForecastResponse["source"], string> = {
  ml: "Per-ride XGBoost predictions.",
  historical: "No model output for this date — showing historical averages for this day of week.",
  groq: "No per-ride data for this date yet.",
};

export default function WaitTimesView({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Inline rather than behind a useCallback so no setState runs
    // synchronously in the effect body — every setState below is post-await.
    // Aborting on date change also keeps a slow earlier response from
    // overwriting the date currently on screen.
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/forecast?date=${date}`, { signal: controller.signal });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(typeof body.error === "string" ? body.error : "Request failed");
        }
        setData(body);
        setError(null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Something went wrong");
        setData(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [date]);

  function handleDateChange(next: string) {
    setLoading(true);
    setDate(next);
    // Keep the URL shareable and back-navigable without a re-render round trip.
    window.history.replaceState(null, "", `/wait-times?date=${next}`);
  }

  const rides = data?.forecasts ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <DisneyDatePicker value={date} onChange={handleDateChange} label="Select a date" />
        {data?.crowdScore !== null && data?.crowdScore !== undefined && (
          <div
            className="rounded-xl px-4 py-2.5 text-sm"
            style={{
              background: `${crowdLabel(data.crowdScore).color}14`,
              border: `1px solid ${crowdLabel(data.crowdScore).color}33`,
              color: crowdLabel(data.crowdScore).color,
            }}
          >
            <span className="font-semibold">{data.crowdScore}/100</span>{" "}
            {crowdLabel(data.crowdScore).label}
          </div>
        )}
      </div>

      {loading && <p className="text-warm-700 text-sm">Loading predictions…</p>}

      {!loading && error && (
        <div className="bg-space-card border border-space-700 rounded-2xl px-6 py-5">
          <p className="text-sm text-warm-900">Couldn&apos;t load predictions.</p>
          <p className="text-xs text-warm-700 mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && rides.length === 0 && (
        <div className="bg-space-card border border-space-700 rounded-2xl px-6 py-5">
          <p className="text-sm text-warm-900">
            No per-ride predictions for {format(parseISO(date), "MMMM d, yyyy")} yet.
          </p>
          <p className="text-xs text-warm-700 mt-1">
            Predictions cover roughly the next 30 days, and only after a collection run has
            gathered enough history.
          </p>
        </div>
      )}

      {!loading && !error && rides.length > 0 && (
        <>
          <p className="text-xs text-warm-700">
            {SOURCE_NOTES[data!.source]}{" "}
            {!data!.dataQualityOk && "Recent data collection failed, so these may be stale."}
          </p>
          <RidePredictionTable rides={rides} />
        </>
      )}
    </div>
  );
}
