"use client";

import { useEffect, useState } from "react";
import AccuracyChart from "@/components/AccuracyChart";

type Summary = {
  mae: number;
  within5: number;
  within10: number;
  within15: number;
  totalPredictions: number;
};

type PerRide = {
  rideId: number;
  rideName: string;
  mae: number;
  within10: number;
  sampleCount: number;
};

type Row = {
  rideId: number;
  rideName: string;
  predictedFor: string;
  predictedWait: number;
  actualWait: number;
  absError: number;
};

type AccuracyData = {
  summary: Summary | null;
  perRide: PerRide[];
  rows: Row[];
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-space-card border border-space-700 rounded-2xl px-6 py-5 shadow-sm">
      <p className="text-xs text-warm-700 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-2xl font-semibold text-warm-900 mt-1">{value}</p>
    </div>
  );
}

export default function AccuracyPage() {
  const [data, setData] = useState<AccuracyData | null>(null);
  const [selectedRide, setSelectedRide] = useState<string>("");
  const [dataQualityOk, setDataQualityOk] = useState(true);

  useEffect(() => {
    fetch("/api/accuracy")
      .then((r) => r.json())
      .then((d: AccuracyData) => {
        setData(d);
        if (d.perRide.length > 0) setSelectedRide(d.perRide[0].rideName);
      });

    fetch("/api/forecast?date=" + new Date().toISOString().split("T")[0])
      .then((r) => r.json())
      .then((d) => setDataQualityOk(d.dataQualityOk ?? true));
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl border border-space-600 flex items-center justify-center text-orange-400 shrink-0"
            style={{ background: "rgba(59,130,246,0.08)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-warm-900 tracking-tight">Prediction Accuracy</h1>
            <p className="text-warm-700 text-sm mt-0.5">
              How well our model&apos;s predictions matched actual wait times — last 30 days.
            </p>
          </div>
        </div>
        {!dataQualityOk && (
          <div className="text-xs text-warm-700 bg-space-card border border-space-700 rounded-lg px-3 py-2">
            Recent data collection issues — accuracy stats may be incomplete.
          </div>
        )}
      </div>

      {data?.summary ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Avg Error" value={`±${data.summary.mae.toFixed(1)} min`} />
            <StatCard label="Within 10 min" value={`${Math.round(data.summary.within10 * 100)}%`} />
            <StatCard label="Within 15 min" value={`${Math.round(data.summary.within15 * 100)}%`} />
            <StatCard label="Total Predictions" value={data.summary.totalPredictions.toLocaleString()} />
          </div>

          <div className="bg-space-card border border-space-700 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-medium text-warm-900">Predicted vs. Actual</h2>
              <select
                value={selectedRide}
                onChange={(e) => setSelectedRide(e.target.value)}
                className="border border-space-700 rounded-xl px-3 py-1.5 text-sm text-warm-900 bg-cream-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                {data.perRide.map((r) => (
                  <option key={r.rideId} value={r.rideName}>{r.rideName}</option>
                ))}
              </select>
            </div>
            {selectedRide && <AccuracyChart rows={data.rows} rideName={selectedRide} />}
          </div>

          <div className="bg-space-card border border-space-700 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-space-700">
              <h2 className="font-medium text-warm-900">Per-Ride Breakdown</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-cream-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide">Ride</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide">Avg Error</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide">Within 10 min</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide">Samples</th>
                </tr>
              </thead>
              <tbody>
                {data.perRide.map((r, i) => (
                  <tr key={r.rideId} className={i % 2 === 0 ? "bg-space-card" : "bg-cream-100"}>
                    <td className="px-4 py-3 font-medium text-warm-900">{r.rideName}</td>
                    <td className="px-4 py-3 text-warm-700">±{r.mae.toFixed(1)} min</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-cream-200 rounded-full h-1.5 max-w-24">
                          <div
                            className="h-1.5 rounded-full bg-orange-500"
                            style={{ width: `${Math.round(r.within10 * 100)}%` }}
                          />
                        </div>
                        <span className="text-warm-700 text-xs">{Math.round(r.within10 * 100)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-warm-700">{r.sampleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="bg-space-card border border-space-700 rounded-2xl p-8 text-center shadow-sm">
          <p className="text-warm-700 text-sm">
            No accuracy data yet. Once the model has made predictions and actual data has been
            collected for those times, comparisons will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
