/**
 * @jest-environment jsdom
 */

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import WaitTimesView from "@/components/WaitTimesView";

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@/components/RideForecastChart", () => ({
  __esModule: true,
  default: ({ rideId, rideName, date }: { rideId: number; rideName: string; date: string }) => (
    <div data-testid="hourly-chart" data-ride-id={rideId} data-date={date}>
      Hourly chart: {rideName}
    </div>
  ),
}));

const forecasts = [
  { rideId: 1, rideName: "Space Mountain", landName: "Tomorrowland", avgWait: 35, peakWait: 90, mlConfidence: 0.92 },
  { rideId: 2, rideName: "Haunted Mansion", landName: "New Orleans Square", avgWait: 50, peakWait: 60, mlConfidence: 0.75 },
];

function forecastResponse() {
  return {
    ok: true,
    json: async () => ({
      date: "2026-07-04",
      crowdScore: 80,
      forecasts,
      source: "ml",
      dataQualityOk: true,
      lastCollectedAt: null,
    }),
  } as Response;
}

describe("WaitTimesView", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    global.fetch = jest.fn().mockResolvedValue(forecastResponse());
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
    global.fetch = originalFetch;
  });

  it("shows an hourly chart for the highest-peak ride and ride-selection cards", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<WaitTimesView initialDate="2026-07-04" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const chart = container.querySelector("[data-testid='hourly-chart']")!;
    expect(chart.textContent).toContain("Space Mountain");
    expect(chart.getAttribute("data-ride-id")).toBe("1");
    expect(container.textContent).toContain("Hourly Wait Forecast");
    expect(container.textContent).toContain("Haunted Mansion");
  });

  it("switches the hourly chart when a different ride is selected", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<WaitTimesView initialDate="2026-07-04" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const hauntedCard = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Haunted Mansion")
    )!;
    act(() => hauntedCard.click());

    const chart = container.querySelector("[data-testid='hourly-chart']")!;
    expect(chart.textContent).toContain("Haunted Mansion");
    expect(chart.getAttribute("data-ride-id")).toBe("2");
    expect(hauntedCard.getAttribute("aria-pressed")).toBe("true");
  });
});
