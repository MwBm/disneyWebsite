"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import RidePredictionTable from "@/components/RidePredictionTable";
import DisneyDatePicker from "@/components/DisneyDatePicker";

type Ride = {
  rideId: number;
  rideName: string;
  landName: string;
  predictedWait: number;
  mlConfidence: number;
  forecastFor: string;
};

const TIPS = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
    ),
    text: "Arrive at rope drop — waits are shortest in the first 90 minutes.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11l19-9-9 19-2-8-8-2z"/>
      </svg>
    ),
    text: "Ride during peak meal hours (noon–2 PM) when crowds thin out.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    ),
    text: "Evening is great for headliners — many guests leave after fireworks.",
  },
];

function WaitTimesContent() {
  const searchParams = useSearchParams();
  const urlDate = searchParams.get("date");

  const [date, setDate] = useState(urlDate ?? format(new Date(), "yyyy-MM-dd"));
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

      const hourFiltered: Ride[] = (data.forecasts ?? []).filter(
        (f: Ride) => new Date(f.forecastFor).getHours() === Number(hour)
      );
      // Deduplicate by rideId — keep highest mlConfidence per ride
      const byRideId = new Map<number, Ride>();
      for (const f of hourFiltered) {
        const existing = byRideId.get(f.rideId);
        if (!existing || f.mlConfidence > existing.mlConfidence) {
          byRideId.set(f.rideId, f);
        }
      }
      setRides(Array.from(byRideId.values()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl border border-space-600 flex items-center justify-center text-orange-400 shrink-0"
          style={{ background: "rgba(240,192,96,0.07)", border: "1px solid rgba(240,192,96,0.14)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-warm-900 tracking-tight">Wait Time Predictions</h1>
          <p className="text-warm-700 text-sm mt-0.5">Per-ride predicted wait times for a specific date and hour.</p>
        </div>
      </div>

      <div className="bg-space-card border border-space-700 rounded-2xl p-5 neon neon-blue">
        <div className="flex gap-3 flex-wrap items-end">
          <DisneyDatePicker value={date} onChange={setDate} label="Date" />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-warm-700 font-medium uppercase tracking-wide">Hour</label>
            <select
              value={hour}
              onChange={(e) => setHour(e.target.value)}
              className="border border-cream-200 rounded-xl px-4 py-2 text-warm-900 bg-cream-50 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              {Array.from({ length: 15 }, (_, i) => i + 8).map((h) => (
                <option key={h} value={String(h).padStart(2, "0")}>
                  {h % 12 || 12}:00 {h < 12 ? "AM" : "PM"}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={fetch_}
            disabled={loading}
            className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? "Loading…" : "Show Predictions"}
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {rides === null && !loading && (
        <div className="grid sm:grid-cols-3 gap-3">
          {TIPS.map((tip, i) => {
            const neon = ["neon-blue", "neon-purple", "neon-cyan"][i % 3];
            return (
              <div key={i} className={`bg-space-card border border-space-700 rounded-2xl px-4 py-4 neon ${neon} flex gap-3 items-start`}>
                <span className="text-orange-400 shrink-0 mt-0.5">{tip.icon}</span>
                <p className="text-sm text-warm-700 leading-relaxed">{tip.text}</p>
              </div>
            );
          })}
        </div>
      )}

      {rides !== null && rides.length === 0 && (
        <div className="bg-space-card border border-space-700 rounded-2xl p-8 text-center shadow-sm">
          <div className="flex justify-center mb-3 text-warm-500">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </div>
          <p className="text-warm-700 text-sm">
            No predictions available for that time yet — check back after data collection runs.
          </p>
        </div>
      )}

      {rides !== null && rides.length > 0 && <RidePredictionTable rides={rides} />}
    </div>
  );
}

export default function WaitTimesPage() {
  return (
    <Suspense fallback={null}>
      <WaitTimesContent />
    </Suspense>
  );
}
