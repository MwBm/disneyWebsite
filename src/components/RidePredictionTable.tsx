"use client";

import { useState } from "react";

type Ride = {
  rideId: number;
  rideName: string;
  landName: string;
  predictedWait: number;
  mlConfidence: number;
};

type SortKey = "predictedWait" | "rideName" | "landName";

function waitColor(minutes: number) {
  if (minutes <= 20) return "#22c55e";
  if (minutes <= 45) return "#f59e0b";
  if (minutes <= 75) return "#f97316";
  return "#ef4444";
}

export default function RidePredictionTable({ rides }: { rides: Ride[] }) {
  const [sort, setSort] = useState<SortKey>("predictedWait");
  const [asc, setAsc] = useState(false);

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc((v) => !v);
    else { setSort(key); setAsc(false); }
  }

  const sorted = [...rides].sort((a, b) => {
    const av = a[sort];
    const bv = b[sort];
    const cmp = typeof av === "number" ? av - (bv as number) : String(av).localeCompare(String(bv));
    return asc ? cmp : -cmp;
  });

  function Header({ k, label }: { k: SortKey; label: string }) {
    return (
      <th
        onClick={() => toggleSort(k)}
        className="text-left px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide cursor-pointer select-none hover:text-orange-400 transition-colors"
      >
        {label} {sort === k ? (asc ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-space-700 shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-cream-200">
          <tr>
            <Header k="rideName" label="Ride" />
            <Header k="landName" label="Land" />
            <Header k="predictedWait" label="Predicted Wait" />
            <th className="text-left px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide">
              Confidence
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ride, i) => (
            <tr key={`${ride.rideId}-${i}`} className={i % 2 === 0 ? "bg-space-card" : "bg-cream-100"}>
              <td className="px-4 py-3 font-medium text-warm-900">{ride.rideName}</td>
              <td className="px-4 py-3 text-warm-700">{ride.landName}</td>
              <td className="px-4 py-3">
                <span
                  className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: waitColor(ride.predictedWait) }}
                >
                  {ride.predictedWait} min
                </span>
              </td>
              <td className="px-4 py-3 text-warm-700">
                {Math.round(ride.mlConfidence * 100)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
