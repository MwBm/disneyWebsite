"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import DisneyDatePicker from "./DisneyDatePicker";
import RideForecastChart from "./RideForecastChart";
import { crowdLabel, waitColor } from "@/lib/crowd";
import type { RideDayForecast } from "@/lib/forecast-queries";


type ForecastResponse = {
  date: string;
  crowdScore: number | null;
  forecasts: RideDayForecast[];
  source: "ml" | "historical" | "groq";
  dataQualityOk: boolean;
  lastCollectedAt: string | null;
};

const EMPTY_RIDES: RideDayForecast[] = [];

/** How the numbers were produced, stated plainly rather than implied. */
const SOURCE_NOTES: Record<ForecastResponse["source"], string> = {
  ml: "Per-ride XGBoost predictions for each park hour.",
  historical: "No model output for this date — showing typical hourly waits for this day of week over the last two years.",
  groq: "No per-ride data for this date yet.",
};

function defaultRideId(rides: RideDayForecast[]): number | null {
  return rides.reduce<RideDayForecast | null>(
    (highest, ride) =>
      highest === null || ride.peakWait > highest.peakWait ? ride : highest,
    null
  )?.rideId ?? null;
}

function RideCard({
  ride,
  selected,
  onClick,
}: {
  ride: RideDayForecast;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full text-left rounded-2xl border p-4 transition-all cursor-pointer ${
        selected
          ? "border-orange-400 bg-orange-500/10 ring-2 ring-orange-400/20"
          : "border-space-700 bg-space-card neon hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-warm-900 leading-snug">{ride.rideName}</p>
          <p className="text-xs text-warm-700 mt-0.5">{ride.landName}</p>
        </div>
        <span
          className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: waitColor(ride.peakWait) }}
        >
          {ride.peakWait} min peak
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-warm-700">
        <span>Day average: {ride.avgWait} min</span>
        <span>{Math.round(ride.mlConfidence * 100)}% confidence</span>
      </div>
    </button>
  );
}

export default function WaitTimesView({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRideId, setSelectedRideId] = useState<number | null>(null);

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
        const nextData = body as ForecastResponse;
        setData(nextData);
        setSelectedRideId((current) =>
          nextData.forecasts.some((ride) => ride.rideId === current)
            ? current
            : defaultRideId(nextData.forecasts)
        );
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

  const rides = data?.forecasts ?? EMPTY_RIDES;
  const sortedRides = useMemo(
    () => [...rides].sort((a, b) => b.peakWait - a.peakWait || a.rideName.localeCompare(b.rideName)),
    [rides]
  );
  const selectedRide = rides.find((ride) => ride.rideId === selectedRideId) ?? sortedRides[0] ?? null;

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

          {selectedRide && (
            <div className="bg-space-card border border-space-700 rounded-2xl p-6 shadow-sm neon">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h2 className="font-medium text-warm-900">Hourly Wait Forecast</h2>
                  <p className="text-xs text-warm-700 mt-0.5">
                    {selectedRide.rideName} · Park time (Pacific)
                  </p>
                </div>
                <span className="text-xs text-warm-700 border border-space-700 rounded-lg px-2.5 py-1 bg-cream-100">
                  Select a ride below to switch
                </span>
              </div>
              <RideForecastChart
                rideId={selectedRide.rideId}
                rideName={selectedRide.rideName}
                date={date}
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="font-medium text-warm-900">Ride Forecasts</h2>
              <p className="text-xs text-warm-700">Sorted by peak wait</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sortedRides.map((ride) => (
                <RideCard
                  key={ride.rideId}
                  ride={ride}
                  selected={ride.rideId === selectedRide?.rideId}
                  onClick={() => setSelectedRideId(ride.rideId)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
