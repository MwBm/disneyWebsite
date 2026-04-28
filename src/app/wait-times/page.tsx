"use client";

import { useState } from "react";
import { format } from "date-fns";
import RidePredictionTable from "@/components/RidePredictionTable";

type Ride = {
  rideId: number;
  rideName: string;
  landName: string;
  predictedWait: number;
  mlConfidence: number;
  forecastFor: string;
};

export default function WaitTimesPage() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [hour, setHour] = useState(String(new Date().getHours()).padStart(2, "0"));
  const [loading, setLoading] = useState(false);
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetch_() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/forecast?date=${date}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");

      // Filter to the selected hour
      const filtered: Ride[] = (data.forecasts ?? [])
        .filter((f: Ride) => new Date(f.forecastFor).getHours() === Number(hour))
        .map((f: Ride) => ({
          rideId: f.rideId,
          rideName: f.rideName,
          landName: f.landName,
          predictedWait: f.predictedWait,
          mlConfidence: f.mlConfidence,
          forecastFor: f.forecastFor,
        }));

      setRides(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-warm-900 tracking-tight">
          Wait Time Predictions
        </h1>
        <p className="text-warm-700 text-sm mt-1">
          Per-ride predicted wait times for a specific date and hour.
        </p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-warm-700 font-medium uppercase tracking-wide">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-cream-200 rounded-xl px-4 py-2 text-warm-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-warm-700 font-medium uppercase tracking-wide">Hour</label>
          <select
            value={hour}
            onChange={(e) => setHour(e.target.value)}
            className="border border-cream-200 rounded-xl px-4 py-2 text-warm-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            {Array.from({ length: 15 }, (_, i) => i + 8).map((h) => (
              <option key={h} value={String(h).padStart(2, "0")}>
                {h % 12 || 12}:00 {h < 12 ? "AM" : "PM"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col justify-end">
          <button
            onClick={fetch_}
            disabled={loading}
            className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? "Loading…" : "Show Predictions"}
          </button>
        </div>
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {rides !== null && rides.length === 0 && (
        <p className="text-warm-700 text-sm">
          No predictions available for that time yet — check back after data collection runs.
        </p>
      )}

      {rides !== null && rides.length > 0 && <RidePredictionTable rides={rides} />}
    </div>
  );
}
