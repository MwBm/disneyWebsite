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
import { format, parseISO } from "date-fns";

type Row = {
  rideId: number;
  rideName: string;
  predictedFor: string;
  predictedWait: number;
  actualWait: number;
  absError: number;
};

export default function AccuracyChart({
  rows,
  rideName,
}: {
  rows: Row[];
  rideName: string;
}) {
  const rideRows = rows
    .filter((r) => r.rideName === rideName)
    .sort((a, b) => a.predictedFor.localeCompare(b.predictedFor))
    .slice(-48); // last 48 data points

  const data = rideRows.map((r) => ({
    date: format(parseISO(r.predictedFor), "MM/dd HH:mm"),
    Predicted: r.predictedWait,
    Actual: r.actualWait,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#6b5f57" }}
          tickLine={false}
          axisLine={{ stroke: "#f0ebe3" }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#6b5f57" }}
          tickLine={false}
          axisLine={false}
          unit=" min"
          width={52}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#fff",
            border: "1px solid #f0ebe3",
            borderRadius: 12,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="Predicted"
          stroke="#c94a1f"
          strokeWidth={2}
          dot={false}
          strokeDasharray="4 2"
        />
        <Line
          type="monotone"
          dataKey="Actual"
          stroke="#1a1410"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
