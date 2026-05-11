/**
 * @jest-environment jsdom
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import ChatAssistant from "@/components/ChatAssistant";

global.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollIntoView = jest.fn();

function makeEmptyStreamFetch() {
  const reader = {
    read: jest.fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array() })
      .mockResolvedValueOnce({ done: true, value: undefined }),
  };
  return jest.fn().mockResolvedValue({
    ok: true,
    body: { getReader: () => reader },
  } as unknown as Response);
}

describe("ChatAssistant", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
      root.render(<ChatAssistant />);
    });
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.removeChild(container);
    global.fetch = originalFetch;
  });

  it("renders input and send button", () => {
    const input = container.querySelector("input");
    const button = container.querySelector("button[type='submit']");
    expect(input).not.toBeNull();
    expect(button).not.toBeNull();
  });

  it("send button disabled when input is empty", () => {
    const button = container.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("sends user message and calls /api/chat", async () => {
    global.fetch = makeEmptyStreamFetch();

    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "hi");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ method: "POST" }));
    expect(container.textContent).toContain("hi");
  });

  it("shows error message when fetch rejects", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "test question");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(container.textContent).toContain("Sorry, something went wrong");
  });

  it("shows error message when fetch returns non-ok status", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, body: null } as Response);

    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(container.textContent).toContain("Sorry, something went wrong");
  });

  it("unmounts cleanly without throwing", () => {
    expect(() => {
      act(() => { root.unmount(); });
      // Re-mount so afterEach cleanup works
      root = createRoot(container);
      act(() => { root.render(<ChatAssistant />); });
    }).not.toThrow();
  });
});
