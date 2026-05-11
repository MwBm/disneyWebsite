"use client";

import { useEffect, useMemo, useState } from "react";
import AccuracyChart from "@/components/AccuracyChart";
import PageHeader from "@/components/PageHeader";
import { filterAndSortRides } from "@/lib/accuracy-filters";
import type { PerRide, ParkFilter, SortKey } from "@/lib/accuracy-filters";

type Summary = {
  mae: number;
  within5: number;
  within10: number;
  within15: number;
  totalPredictions: number;
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

type RawRow = {
  rideId: number;
  rideName: string;
  landName: string;
  waitTime: number;
  isOpen: boolean;
  windowedAt: string;
  recordedAt: string;
};


type RawSortKey = "time-desc" | "time-asc" | "wait-desc" | "wait-asc" | "alpha";
type Tab = "accuracy" | "raw";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-space-card border border-space-700 rounded-2xl px-6 py-5 shadow-sm neon">
      <p className="text-xs text-warm-700 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-2xl font-semibold text-warm-900 mt-1">{value}</p>
    </div>
  );
}

function MaeBar({ value }: { value: number }) {
  // MAE range: 0–30 min for color purposes
  const pct = Math.min(value / 30, 1);
  const hue = Math.round(120 - pct * 120); // green → red
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-cream-200 rounded-full h-1.5">
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${Math.round(pct * 100)}%`, background: `hsl(${hue},70%,45%)` }}
        />
      </div>
    </div>
  );
}

function Within10Bar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-cream-200 rounded-full h-1.5">
        <div
          className="h-1.5 rounded-full bg-orange-500 transition-all"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="text-warm-700 text-xs w-8 text-right">{Math.round(value * 100)}%</span>
    </div>
  );
}

function RideCard({
  ride,
  selected,
  onClick,
}: {
  ride: PerRide;
  selected: boolean;
  onClick: () => void;
}) {
  const maeColor =
    ride.mae <= 5
      ? "text-green-600"
      : ride.mae <= 10
      ? "text-orange-500"
      : "text-red-500";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border p-4 transition-all shadow-sm cursor-pointer ${
        selected
          ? "border-orange-400 bg-orange-500/10 ring-2 ring-orange-400/20"
          : "border-space-700 bg-space-card neon hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="text-sm font-medium text-warm-900 leading-snug">{ride.rideName}</span>
        <span className={`text-base font-semibold shrink-0 ${maeColor}`}>
          ±{ride.mae.toFixed(1)}
        </span>
      </div>
      <MaeBar value={ride.mae} />
      <div className="mt-2.5">
        <Within10Bar value={ride.within10} />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-warm-700">{ride.landName}</span>
        <span className="text-xs text-warm-700">{ride.sampleCount} samples</span>
      </div>
    </button>
  );
}

function RawDataTable({ rows }: { rows: RawRow[] }) {
  const [sortKey, setSortKey] = useState<RawSortKey>("time-desc");
  const [search, setSearch] = useState("");
  const [showClosedRides, setShowClosedRides] = useState(false);

  const sorted = useMemo(() => {
    let r = rows.filter((row) => {
      if (!showClosedRides && !row.isOpen) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return row.rideName.toLowerCase().includes(q) || row.landName.toLowerCase().includes(q);
      }
      return true;
    });
    switch (sortKey) {
      case "time-desc": return [...r].sort((a, b) => b.windowedAt.localeCompare(a.windowedAt));
      case "time-asc":  return [...r].sort((a, b) => a.windowedAt.localeCompare(b.windowedAt));
      case "wait-desc": return [...r].sort((a, b) => b.waitTime - a.waitTime);
      case "wait-asc":  return [...r].sort((a, b) => a.waitTime - b.waitTime);
      case "alpha":     return [...r].sort((a, b) => a.rideName.localeCompare(b.rideName));
    }
  }, [rows, sortKey, search, showClosedRides]);

  const windows = useMemo(() => {
    const s = new Set(rows.map((r) => r.windowedAt));
    return s.size;
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <p className="text-xs text-warm-700">
          {rows.length} records across {windows} collection window{windows !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-1.5 text-xs text-warm-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showClosedRides}
              onChange={(e) => setShowClosedRides(e.target.checked)}
              className="rounded"
            />
            Show closed rides
          </label>
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-warm-700" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Filter rides..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 pr-3 py-1.5 text-sm border border-space-700 rounded-xl bg-cream-100 text-warm-900 placeholder:text-warm-700 focus:outline-none focus:ring-2 focus:ring-orange-500 w-40"
            />
          </div>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as RawSortKey)}
            className="border border-space-700 rounded-xl px-3 py-1.5 text-sm text-warm-900 bg-cream-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="time-desc">Newest first</option>
            <option value="time-asc">Oldest first</option>
            <option value="wait-desc">Longest wait first</option>
            <option value="wait-asc">Shortest wait first</option>
            <option value="alpha">A → Z</option>
          </select>
        </div>
      </div>

      <div className="bg-space-card border border-space-700 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-space-700 text-left">
                <th className="px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide whitespace-nowrap">Window (UTC)</th>
                <th className="px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide">Ride</th>
                <th className="px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide">Land</th>
                <th className="px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide text-right">Wait</th>
                <th className="px-4 py-3 text-xs font-medium text-warm-700 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-space-700">
              {sorted.map((row, i) => {
                const window = new Date(row.windowedAt);
                const timeStr = window.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
                const dateStr = window.toLocaleDateString([], { month: "short", day: "numeric" });
                return (
                  <tr key={i} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-2.5 text-warm-700 text-xs whitespace-nowrap font-mono">
                      {dateStr} {timeStr}
                    </td>
                    <td className="px-4 py-2.5 text-warm-900 font-medium">{row.rideName}</td>
                    <td className="px-4 py-2.5 text-warm-700 text-xs">{row.landName}</td>
                    <td className="px-4 py-2.5 text-right">
                      {row.isOpen ? (
                        <span className={`font-semibold ${row.waitTime > 60 ? "text-red-500" : row.waitTime > 30 ? "text-orange-500" : "text-green-600"}`}>
                          {row.waitTime} min
                        </span>
                      ) : (
                        <span className="text-warm-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                        row.isOpen
                          ? "bg-green-500/10 text-green-600 border border-green-500/20"
                          : "bg-warm-600/10 text-warm-600 border border-warm-600/20"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${row.isOpen ? "bg-green-500" : "bg-warm-600"}`} />
                        {row.isOpen ? "Open" : "Closed"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-warm-700 text-sm">
                    No records match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AccuracyPage() {
  const [tab, setTab] = useState<Tab>("accuracy");
  const [data, setData] = useState<AccuracyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rawRows, setRawRows] = useState<RawRow[] | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [selectedRide, setSelectedRide] = useState<string>("");
  const [dataQualityOk, setDataQualityOk] = useState(true);
  const [parkFilter, setParkFilter] = useState<ParkFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("alpha");
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/accuracy", { cache: "force-cache" }).then((r) => r.json()),
      fetch("/api/forecast?date=" + new Date().toISOString().split("T")[0], { cache: "force-cache" }).then((r) => r.json()),
    ]).then(([accuracyData, forecastData]: [AccuracyData, { dataQualityOk?: boolean }]) => {
      setData(accuracyData);
      if (accuracyData.perRide.length > 0) setSelectedRide(accuracyData.perRide[0].rideName);
      setDataQualityOk(forecastData.dataQualityOk ?? true);
    }).finally(() => setLoading(false));
  }, []);

  function switchToRaw() {
    setTab("raw");
    if (rawRows !== null) return;
    setRawLoading(true);
    fetch("/api/raw-data?hours=2")
      .then((r) => r.json())
      .then((d) => setRawRows(d.rows))
      .finally(() => setRawLoading(false));
  }

  const filteredRides = useMemo(
    () => filterAndSortRides(data?.perRide ?? [], parkFilter, search, sortKey),
    [data, parkFilter, sortKey, search]
  );

  const parkCounts = useMemo(() => {
    if (!data) return { all: 0, dl: 0, dca: 0 };
    return {
      all: data.perRide.length,
      dl: data.perRide.filter((r) => r.parkName === "Disneyland").length,
      dca: data.perRide.filter((r) => r.parkName === "Disney California Adventure").length,
    };
  }, [data]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <PageHeader
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          }
          title="Prediction Accuracy"
          subtitle="How well our model's predictions matched actual wait times — last 30 days."
        />
        <div className="flex items-center gap-1 p-1 bg-cream-200 rounded-xl border border-space-700">
          <button
            onClick={() => setTab("accuracy")}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === "accuracy"
                ? "bg-space-card text-warm-900 shadow-sm border border-space-700"
                : "text-warm-700 hover:text-warm-900"
            }`}
          >
            Accuracy
          </button>
          <button
            onClick={switchToRaw}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === "raw"
                ? "bg-space-card text-warm-900 shadow-sm border border-space-700"
                : "text-warm-700 hover:text-warm-900"
            }`}
          >
            Recent Data (2h)
          </button>
        </div>
      </div>

      {loading && (
        <div className="bg-space-card border border-space-700 rounded-2xl p-8 text-center shadow-sm">
          <p className="text-warm-700 text-sm">Loading accuracy data…</p>
        </div>
      )}

      {!dataQualityOk && (
        <div className="text-xs text-warm-700 bg-space-card border border-space-700 rounded-lg px-3 py-2 self-start">
          Recent data collection issues — accuracy stats may be incomplete.
        </div>
      )}

      {tab === "raw" && (
        rawLoading ? (
          <div className="bg-space-card border border-space-700 rounded-2xl p-8 text-center shadow-sm">
            <p className="text-warm-700 text-sm">Loading…</p>
          </div>
        ) : rawRows !== null ? (
          <RawDataTable rows={rawRows} />
        ) : null
      )}

      {tab === "accuracy" && !data?.summary && (
        <div className="bg-space-card border border-space-700 rounded-2xl p-8 text-center shadow-sm">
          <p className="text-warm-700 text-sm">
            No accuracy data yet. Once the model has made predictions and actual data has been
            collected for those times, comparisons will appear here.
          </p>
        </div>
      )}

      {tab === "accuracy" && data?.summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Avg Error" value={`±${data.summary.mae.toFixed(1)} min`} />
            <StatCard label="Within 10 min" value={`${Math.round(data.summary.within10 * 100)}%`} />
            <StatCard label="Within 15 min" value={`${Math.round(data.summary.within15 * 100)}%`} />
            <StatCard label="Total Predictions" value={data.summary.totalPredictions.toLocaleString()} />
          </div>

          {/* Chart */}
          <div className="bg-space-card border border-space-700 rounded-2xl p-6 shadow-sm neon">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h2 className="font-medium text-warm-900">Predicted vs. Actual</h2>
                {selectedRide && (
                  <p className="text-xs text-warm-700 mt-0.5">{selectedRide}</p>
                )}
              </div>
              <span className="text-xs text-warm-700 border border-space-700 rounded-lg px-2.5 py-1 bg-cream-100">
                Click a card below to switch rides
              </span>
            </div>
            {selectedRide && <AccuracyChart rows={data.rows} rideName={selectedRide} />}
          </div>

          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            {/* Park tabs */}
            <div className="flex gap-1 p-1 bg-cream-200 rounded-xl border border-space-700">
              {(
                [
                  ["all", `All (${parkCounts.all})`],
                  ["Disneyland", `DL (${parkCounts.dl})`],
                  ["Disney California Adventure", `DCA (${parkCounts.dca})`],
                ] as [ParkFilter, string][]
              ).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setParkFilter(val)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    parkFilter === val
                      ? "bg-space-card text-warm-900 shadow-sm border border-space-700"
                      : "text-warm-700 hover:text-warm-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              {/* Search */}
              <div className="relative">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-warm-700"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Search rides..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 pr-3 py-1.5 text-sm border border-space-700 rounded-xl bg-cream-100 text-warm-900 placeholder:text-warm-700 focus:outline-none focus:ring-2 focus:ring-orange-500 w-44"
                />
              </div>

              {/* Sort */}
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="border border-space-700 rounded-xl px-3 py-1.5 text-sm text-warm-900 bg-cream-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="mae-asc">Best accuracy first</option>
                <option value="mae-desc">Worst accuracy first</option>
                <option value="alpha">A → Z</option>
                <option value="samples-desc">Most data first</option>
              </select>
            </div>
          </div>

          {/* Card grid */}
          {filteredRides.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredRides.map((ride) => (
                <RideCard
                  key={ride.rideId}
                  ride={ride}
                  selected={selectedRide === ride.rideName}
                  onClick={() => setSelectedRide(ride.rideName)}
                />
              ))}
            </div>
          ) : (
            <div className="bg-space-card border border-space-700 rounded-2xl p-8 text-center shadow-sm neon">
              <p className="text-warm-700 text-sm">No rides match your filters.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
