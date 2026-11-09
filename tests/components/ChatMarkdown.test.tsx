/**
 * @jest-environment jsdom
 */

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ChatMarkdown from "@/components/ChatMarkdown";

global.IS_REACT_ACT_ENVIRONMENT = true;

describe("ChatMarkdown", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("renders headings, bold text, and bullet points instead of raw Markdown", () => {
    act(() => {
      root.render(<ChatMarkdown content={"### Best move\n\nStart with **Space Mountain**.\n\n* Ride it before **10 min** waits turn into 45."} />);
    });

    expect(container.querySelector("h3")?.textContent).toBe("Best move");
    expect(container.querySelector("strong")?.textContent).toBe("Space Mountain");
    expect(container.querySelector("ul li")?.textContent).toContain("Ride it before 10 min waits");
    expect(container.textContent).not.toContain("**");
  });

  it("does not render model-provided HTML", () => {
    act(() => {
      root.render(<ChatMarkdown content={'<img src=x onerror="alert(1)"> **Safe**'} />);
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
