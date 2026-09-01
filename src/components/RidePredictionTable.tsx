"use client";

import { useState, useMemo } from "react";
import { waitColor } from "@/lib/crowd";

type Ride = {
  rideId: number;
  rideName: string;
  landName: string;
  predictedWait: number;
  mlConfidence: number;
};

type SortKey = "predictedWait" | "rideName" | "landName";

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-cream-200 rounded-full h-1.5">
        <div
          className="h-1.5 rounded-full bg-orange-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-warm-700 text-xs w-7 text-right">{pct}%</span>
    </div>
  );
}

/**
 * Declared at module scope, not inside the table body: a component created
 * during render is a new component type on every render, so React unmounts and
 * remounts every header cell each time the table re-renders.
 */
function Header({
  k,
  label,
  sort,
  asc,
  onSort,
}: {
  k: SortKey;
  label: string;
  sort: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      onClick={() => onSort(k)}
      className="text-left px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide cursor-pointer select-none hover:text-orange-400 transition-colors"
    >
      {label} {sort === k ? (asc ? "↑" : "↓") : ""}
    </th>
  );
}

export default function RidePredictionTable({ rides }: { rides: Ride[] }) {
  const [sort, setSort] = useState<SortKey>("predictedWait");
  const [asc, setAsc] = useState(false);

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc((v) => !v);
    else { setSort(key); setAsc(false); }
  }

  const sorted = useMemo(() => [...rides].sort((a, b) => {
    const av = a[sort];
    const bv = b[sort];
    const cmp = typeof av === "number" ? av - (bv as number) : String(av).localeCompare(String(bv));
    return asc ? cmp : -cmp;
  }), [rides, sort, asc]);

  return (
    <div className="overflow-x-auto rounded-2xl border border-space-700 shadow-sm neon">
      <table className="w-full text-sm">
        <thead className="bg-cream-200">
          <tr>
            <Header k="rideName" label="Ride" sort={sort} asc={asc} onSort={toggleSort} />
            <Header k="landName" label="Land" sort={sort} asc={asc} onSort={toggleSort} />
            <Header k="predictedWait" label="Predicted Wait" sort={sort} asc={asc} onSort={toggleSort} />
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
              <td className="px-4 py-3 min-w-[8rem]">
                <ConfidenceBar value={ride.mlConfidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
