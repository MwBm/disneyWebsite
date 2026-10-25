"use client";

import { useEffect, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ParkId } from "@/lib/parks";

type ForecastHour = {
  hour: number;
  predictedWait: number;
};

function hourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 || 12;
  return `${displayHour} ${period}`;
}

/** Hourly points come from the selected ride/date endpoint, in Pacific park time. */
export default function RideForecastChart({
  rideId,
  rideName,
  date,
  parkId,
}: {
  rideId: number;
  rideName: string;
  date: string;
  parkId: ParkId;
}) {
  const [rows, setRows] = useState<ForecastHour[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/forecast/rides/${rideId}?date=${date}&park=${parkId}`, {
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

    return () => controller.abort();
  }, [date, parkId, rideId]);

  const data = rows.map((row) => ({
    time: hourLabel(row.hour),
    wait: row.predictedWait,
  }));

  if (loading) {
    return (
      <div className="h-[260px] flex items-center justify-center text-warm-700 text-sm">
        Loading {rideName}&apos;s hourly forecast…
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-[260px] flex items-center justify-center text-warm-700 text-sm text-center px-6">
        No hourly wait forecast is available for {rideName} on this date.
      </div>
    );
  }

  return (
    <div className="h-[260px]" aria-label={`Hourly wait forecast for ${rideName}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="time"
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
            formatter={(value) => [`${value} min`, "Predicted wait"]}
          />
          <Line
            type="monotone"
            dataKey="wait"
            name="Predicted wait"
            stroke="#f97316"
            strokeWidth={2.5}
            dot={{ r: 2, fill: "#f97316", strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
