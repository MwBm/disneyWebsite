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

export default function AccuracyChart({ rows, rideName }: { rows: Row[]; rideName: string }) {
  const rideRows = rows
    .filter((r) => r.rideName === rideName)
    .sort((a, b) => a.predictedFor.localeCompare(b.predictedFor))
    .slice(-48);

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
