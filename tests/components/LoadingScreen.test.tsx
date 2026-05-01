/**
 * @jest-environment jsdom
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import LoadingScreen from "@/components/LoadingScreen";

// Required for React 18 act() in jsdom
// @ts-expect-error - global flag
global.IS_REACT_ACT_ENVIRONMENT = true;

type WindowWithFinish = Window & { finishLoading?: () => void };

// CSS animations don't run in jsdom — suppress the style warnings
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function mountLoadingScreen(): { container: HTMLDivElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: ReturnType<typeof createRoot>;
  act(() => {
    root = createRoot(container);
    root.render(<LoadingScreen />);
  });
  return { container, root };
}

function unmount(container: HTMLDivElement, root: ReturnType<typeof createRoot>) {
  act(() => { root.unmount(); });
  document.body.removeChild(container);
}

describe("LoadingScreen", () => {
  it("renders visible on mount", () => {
    const { container, root } = mountLoadingScreen();
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.visibility).toBe("visible");
    unmount(container, root);
  });

  it("exposes window.finishLoading after mount", () => {
    const { container, root } = mountLoadingScreen();
    expect(typeof (window as WindowWithFinish).finishLoading).toBe("function");
    unmount(container, root);
  });

  it("transitions to hidden after finishLoading() + 800ms", () => {
    const { container, root } = mountLoadingScreen();

    act(() => {
      (window as WindowWithFinish).finishLoading?.();
    });

    // Before the 800ms dismiss timeout — still visible (opacity 1, just animating out)
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.style.opacity).toBe("1");

    act(() => {
      jest.advanceTimersByTime(800);
    });

    expect(overlay.style.visibility).toBe("hidden");
    unmount(container, root);
  });

  it("auto-dismisses after 3 seconds", () => {
    const { container, root } = mountLoadingScreen();
    const overlay = container.firstElementChild as HTMLElement;

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    act(() => {
      jest.advanceTimersByTime(800);
    });

    expect(overlay.style.visibility).toBe("hidden");
    unmount(container, root);
  });

  it("cleans up window.finishLoading on unmount", () => {
    const { container, root } = mountLoadingScreen();
    expect((window as WindowWithFinish).finishLoading).toBeDefined();
    unmount(container, root);
    expect((window as WindowWithFinish).finishLoading).toBeUndefined();
  });
});
