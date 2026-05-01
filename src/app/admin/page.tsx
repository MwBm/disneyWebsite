"use client";

import { useEffect, useState } from "react";

type Row = {
  date: string;
  tier: number | null;
  specialEvent: string | null;
  isHoliday: boolean;
  isSchoolBreak: boolean;
  tierFetchedAt: string | null;
  tierSource: string | null;
};

const TIER_COLORS = ["#94a3b8", "#86efac", "#fde68a", "#fb923c", "#f87171", "#ef4444"];

function TierDot({ tier }: { tier: number | null }) {
  if (tier === null) return <span className="text-warm-500">—</span>;
  const color = TIER_COLORS[Math.min(tier, 5)];
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded"
      style={{ color, background: `${color}18`, border: `1px solid ${color}30` }}
    >
      T{tier}
    </span>
  );
}

export default function AdminPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);

  function load(d: number) {
    setLoading(true);
    fetch(`/api/admin/date-context?days=${d}`)
      .then((r) => r.json())
      .then((data) => {
        setRows(data.rows ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => { load(days); }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-warm-900 tracking-tight">Data Verification</h1>
          <p className="text-warm-700 text-sm mt-0.5">
            Raw DateContext records — tier, special events, holidays stored in DB.
          </p>
        </div>
      </div>

      <div className="bg-space-card border border-space-700 rounded-2xl p-4 neon">
        <p className="text-xs text-warm-500 mb-3 uppercase tracking-wide font-medium">What each field means</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-warm-700">
          <div><span className="text-warm-900 font-medium">Tier (T0–T5)</span> — Disney LLMP price bracket for that day. Sourced from ThemeParks.wiki schedule API. T0 = cheapest/slowest, T5 = most expensive/busiest. A day can be T0 but still have a special event if the regular-park LLMP is cheap and Disney runs an after-hours paid event.</div>
          <div><span className="text-warm-900 font-medium">Special Event</span> — Disney TICKETED_EVENT entry from the schedule API. These are paid after-hours events (parties, etc.) that run <em>in addition</em> to regular park hours. NOT the same as a holiday.</div>
          <div><span className="text-warm-900 font-medium">Holiday</span> — US federal + Disney peak holidays computed locally (Jan 1, Jul 4, MLK Day, Thanksgiving, Christmas, etc.). Stored when the date is synced.</div>
          <div><span className="text-warm-900 font-medium">School Break</span> — Computed from national average school break dates (winter, spring, summer, Thanksgiving week). Approximate — varies by district.</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs text-warm-700">Show next</label>
        <select
          value={days}
          onChange={(e) => { setDays(Number(e.target.value)); load(Number(e.target.value)); }}
          className="border border-space-700 rounded-lg px-2 py-1 text-xs text-warm-900 bg-cream-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
          <option value={365}>365 days</option>
        </select>
        <button
          onClick={() => load(days)}
          className="text-xs px-3 py-1 rounded-lg border border-space-700 text-warm-700 hover:text-orange-400 hover:border-orange-500 transition-colors"
        >
          Refresh
        </button>
        <span className="text-xs text-warm-500">{rows.length} rows in DB</span>
      </div>

      {loading ? (
        <div className="bg-space-card border border-space-700 rounded-2xl p-8 text-center">
          <p className="text-warm-700 text-sm">Loading…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-space-card border border-space-700 rounded-2xl p-8 text-center">
          <p className="text-warm-700 text-sm">No DateContext rows found. Run <code className="text-orange-400 bg-space-800 px-1 rounded">syncDateContext()</code> to populate.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-space-700 neon">
          <table className="w-full text-xs">
            <thead className="bg-cream-200">
              <tr>
                <th className="text-left px-4 py-3 text-warm-700 uppercase tracking-wide font-medium">Date</th>
                <th className="text-left px-4 py-3 text-warm-700 uppercase tracking-wide font-medium">Tier</th>
                <th className="text-left px-4 py-3 text-warm-700 uppercase tracking-wide font-medium">Special Event</th>
                <th className="text-center px-4 py-3 text-warm-700 uppercase tracking-wide font-medium">Holiday</th>
                <th className="text-center px-4 py-3 text-warm-700 uppercase tracking-wide font-medium">School Break</th>
                <th className="text-left px-4 py-3 text-warm-700 uppercase tracking-wide font-medium">Fetched</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const d = new Date(row.date);
                const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
                const dateStr = d.toISOString().slice(0, 10);
                const fetchedAt = row.tierFetchedAt
                  ? new Date(row.tierFetchedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                  : "—";
                return (
                  <tr key={dateStr} className={i % 2 === 0 ? "bg-space-card" : "bg-cream-100"}>
                    <td className="px-4 py-2.5 font-medium text-warm-900 whitespace-nowrap">
                      {dateStr} <span className="text-warm-500 font-normal">{dow}</span>
                    </td>
                    <td className="px-4 py-2.5"><TierDot tier={row.tier} /></td>
                    <td className="px-4 py-2.5 max-w-[200px]">
                      {row.specialEvent ? (
                        <span className="text-orange-400" title={row.specialEvent}>
                          ♦ {row.specialEvent}
                        </span>
                      ) : (
                        <span className="text-warm-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {row.isHoliday ? <span style={{ color: "#60a5fa" }}>★</span> : <span className="text-warm-500">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {row.isSchoolBreak ? <span className="text-green-400">✓</span> : <span className="text-warm-500">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-warm-500">{fetchedAt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-warm-500 text-center pb-2">
        Data coverage is limited to what ThemeParks.wiki returns (~30–60 days). Tier and events beyond that range won&apos;t appear until the schedule API publishes them.
      </p>
    </div>
  );
}
