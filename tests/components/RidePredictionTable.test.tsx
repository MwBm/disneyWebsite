/**
 * @jest-environment jsdom
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import RidePredictionTable from "@/components/RidePredictionTable";

global.IS_REACT_ACT_ENVIRONMENT = true;

const rides = [
  { rideId: 1, rideName: "Space Mountain",  landName: "Tomorrowland", predictedWait: 60, mlConfidence: 0.92 },
  { rideId: 2, rideName: "Haunted Mansion",  landName: "New Orleans Square", predictedWait: 20, mlConfidence: 0.75 },
  { rideId: 3, rideName: "Pirates of the Caribbean", landName: "New Orleans Square", predictedWait: 10, mlConfidence: 0.88 },
];

function mount(container: HTMLDivElement) {
  const root = createRoot(container);
  act(() => { root.render(<RidePredictionTable rides={rides} />); });
  return root;
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

  it("renders all rides", () => {
    mount(container);
    expect(container.textContent).toContain("Space Mountain");
    expect(container.textContent).toContain("Haunted Mansion");
    expect(container.textContent).toContain("Pirates of the Caribbean");
  });

  it("default sort: highest wait first (predictedWait desc)", () => {
    mount(container);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("Space Mountain");
    expect(rows[2].textContent).toContain("Pirates of the Caribbean");
  });

  it("toggles sort to ascending on second click", () => {
    mount(container);
    const waitHeader = Array.from(container.querySelectorAll("th")).find(
      (th) => th.textContent?.includes("Predicted Wait")
    )!;

    // First click → already desc, toggles to asc
    act(() => { waitHeader.click(); });

    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("Pirates of the Caribbean");
    expect(rows[2].textContent).toContain("Space Mountain");
  });

  it("sorts alphabetically by ride name (A→Z)", () => {
    mount(container);
    // Two clicks: first switches to rideName-desc, second toggles to rideName-asc
    act(() => {
      const nameHeader = Array.from(container.querySelectorAll("th")).find(
        (th) => th.textContent?.startsWith("Ride")
      )!;
      nameHeader.click();
    });
    act(() => {
      const nameHeader = Array.from(container.querySelectorAll("th")).find(
        (th) => th.textContent?.startsWith("Ride")
      )!;
      nameHeader.click();
    });

    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("Haunted Mansion");
    expect(rows[1].textContent).toContain("Pirates of the Caribbean");
    expect(rows[2].textContent).toContain("Space Mountain");
  });

  it("renders confidence bar for each ride", () => {
    mount(container);
    const bars = container.querySelectorAll("tbody tr td:last-child");
    expect(bars.length).toBe(3);
    // Each cell should contain a percentage
    expect(bars[0].textContent).toContain("%");
  });
});
