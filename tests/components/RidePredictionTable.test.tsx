/**
 * @jest-environment jsdom
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import RidePredictionTable from "@/components/RidePredictionTable";

global.IS_REACT_ACT_ENVIRONMENT = true;

// Peak and average deliberately rank differently: Haunted Mansion has the
// highest average but Space Mountain the highest peak.
const rides = [
  { rideId: 1, rideName: "Space Mountain", landName: "Tomorrowland", avgWait: 35, peakWait: 90, mlConfidence: 0.92 },
  { rideId: 2, rideName: "Haunted Mansion", landName: "New Orleans Square", avgWait: 50, peakWait: 60, mlConfidence: 0.75 },
  { rideId: 3, rideName: "Pirates of the Caribbean", landName: "New Orleans Square", avgWait: 10, peakWait: 15, mlConfidence: 0.88 },
];

function mount(container: HTMLDivElement, data = rides) {
  const root = createRoot(container);
  act(() => { root.render(<RidePredictionTable rides={data} />); });
  return root;
}

function header(container: HTMLDivElement, text: string) {
  return Array.from(container.querySelectorAll("th")).find((th) => th.textContent?.startsWith(text))!;
}

function rideOrder(container: HTMLDivElement) {
  return Array.from(container.querySelectorAll("tbody tr")).map((tr) => tr.querySelector("td")!.textContent);
}

describe("RidePredictionTable", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("renders one row per ride with its average and peak wait", () => {
    mount(container);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);

    const spaceMountain = Array.from(rows).find((r) => r.textContent?.includes("Space Mountain"))!;
    const cells = spaceMountain.querySelectorAll("td");
    expect(cells[2].textContent).toBe("35 min");
    expect(cells[3].textContent).toBe("90 min");
  });

  it("labels the columns Avg Wait and Peak Wait, explaining each", () => {
    mount(container);
    expect(header(container, "Avg Wait").title).toBe("Average predicted wait from 8 AM to midnight");
    expect(header(container, "Peak Wait").title).toBe("Longest predicted wait at any time of day");
    expect(container.textContent).not.toContain("Predicted Wait");
  });

  it("default sort: highest peak wait first", () => {
    mount(container);
    expect(rideOrder(container)).toEqual(["Space Mountain", "Haunted Mansion", "Pirates of the Caribbean"]);
  });

  it("toggles the peak sort to ascending on a second click", () => {
    mount(container);
    act(() => { header(container, "Peak Wait").click(); });
    expect(rideOrder(container)).toEqual(["Pirates of the Caribbean", "Haunted Mansion", "Space Mountain"]);
  });

  it("sorts by average wait, highest first", () => {
    mount(container);
    act(() => { header(container, "Avg Wait").click(); });
    expect(rideOrder(container)).toEqual(["Haunted Mansion", "Space Mountain", "Pirates of the Caribbean"]);
  });

  it("sorts alphabetically by ride name (A→Z)", () => {
    mount(container);
    // First click sorts rideName descending, second toggles to ascending.
    act(() => { header(container, "Ride").click(); });
    act(() => { header(container, "Ride").click(); });
    expect(rideOrder(container)).toEqual(["Haunted Mansion", "Pirates of the Caribbean", "Space Mountain"]);
  });

  it("renders a confidence bar for each ride", () => {
    mount(container);
    const bars = container.querySelectorAll("tbody tr td:last-child");
    expect(bars.length).toBe(3);
    expect(bars[0].textContent).toBe("92%");
  });

  it("keys rows by ride so re-sorting keeps each row's identity", () => {
    mount(container);
    const before = Array.from(container.querySelectorAll("tbody tr"));
    act(() => { header(container, "Avg Wait").click(); });
    const after = Array.from(container.querySelectorAll("tbody tr"));
    // Same DOM nodes, reordered — not rebuilt — because the key is rideId, not the index.
    expect(new Set(after)).toEqual(new Set(before));
  });

  it("renders an empty body for no rides", () => {
    mount(container, []);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });
});
