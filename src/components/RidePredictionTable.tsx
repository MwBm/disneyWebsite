"use client";

import { useState, useMemo } from "react";
import { waitColor } from "@/lib/crowd";

import type { RideDayForecast } from "@/lib/forecast-queries";

type SortKey = "peakWait" | "avgWait" | "rideName" | "landName";

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
  title,
  sort,
  asc,
  onSort,
}: {
  k: SortKey;
  label: string;
  title?: string;
  sort: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      title={title}
      onClick={() => onSort(k)}
      className="text-left px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide cursor-pointer select-none hover:text-orange-400 transition-colors"
    >
      {label} {sort === k ? (asc ? "↑" : "↓") : ""}
    </th>
  );
}

function WaitBadge({ minutes }: { minutes: number }) {
  return (
    <span
      className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: waitColor(minutes) }}
    >
      {minutes} min
    </span>
  );
}

/** One row per ride: average and peak predicted wait across the day. */
export default function RidePredictionTable({ rides }: { rides: RideDayForecast[] }) {
  const [sort, setSort] = useState<SortKey>("peakWait");
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
            <Header k="avgWait" label="Avg Wait" title="Average predicted wait from 8 AM to midnight" sort={sort} asc={asc} onSort={toggleSort} />
            <Header k="peakWait" label="Peak Wait" title="Longest predicted wait at any time of day" sort={sort} asc={asc} onSort={toggleSort} />
            <th className="text-left px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide">
              Confidence
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ride, i) => (
            <tr key={ride.rideId} className={i % 2 === 0 ? "bg-space-card" : "bg-cream-100"}>
              <td className="px-4 py-3 font-medium text-warm-900">{ride.rideName}</td>
              <td className="px-4 py-3 text-warm-700">{ride.landName}</td>
              <td className="px-4 py-3">
                <WaitBadge minutes={ride.avgWait} />
              </td>
              <td className="px-4 py-3">
                <WaitBadge minutes={ride.peakWait} />
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
