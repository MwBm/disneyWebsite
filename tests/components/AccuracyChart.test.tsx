/**
 * @jest-environment jsdom
 */

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import AccuracyChart from "@/components/AccuracyChart";

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

describe("AccuracyChart", () => {
  const originalFetch = global.fetch;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
    global.fetch = originalFetch;
  });

  it("requests the selected ride from its park", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AccuracyChart parkId={17} rideId={192} rideName="Radiator Springs Racers" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/accuracy/rides/192?park=17",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
