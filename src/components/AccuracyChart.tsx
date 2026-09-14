"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";

type Row = {
  predictedFor: string;
  predictedWait: number;
  actualWait: number;
  absError: number;
};

/** Points come from /api/accuracy/rides/[rideId], already filtered, limited and ordered. */
export default function AccuracyChart({
  rideId,
  rideName,
}: {
  rideId: number;
  rideName: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/accuracy/rides/${rideId}`, {
          signal: controller.signal,
        });
        const body = await res.json();
        setRows(res.ok ? body.rows ?? [] : []);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setRows([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    // Clicking through ride cards quickly must not let an earlier response
    // paint over the ride now selected.
    return () => controller.abort();
  }, [rideId]);

  const data = rows.map((r) => ({
    date: format(parseISO(r.predictedFor), "MM/dd HH:mm"),
    Predicted: r.predictedWait,
    Actual: r.actualWait,
  }));

  if (loading) {
    return (
      <div className="h-[240px] flex items-center justify-center text-warm-700 text-sm">
        Loading {rideName || "chart"}…
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-[240px] flex items-center justify-center text-warm-700 text-sm">
        No matched predictions for {rideName} in the last 30 days.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#7b90b8" }}
          tickLine={false}
          axisLine={{ stroke: "#0e2040" }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#7b90b8" }}
          tickLine={false}
          axisLine={false}
          unit=" min"
          width={52}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#0d1b35",
            border: "1px solid #0e2040",
            borderRadius: 12,
            fontSize: 12,
            color: "#e0eaff",
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#7b90b8" }} />
        <Line
          type="monotone"
          dataKey="Predicted"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          strokeDasharray="4 2"
        />
        <Line
          type="monotone"
          dataKey="Actual"
          stroke="#e0eaff"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
