import { defineConfig, devices } from "@playwright/test";

/**
 * Port 3100, not 3000.
 *
 * With `reuseExistingServer` on and the default port, an unrelated dev server
 * already listening on 3000 gets silently reused — so the suite runs against
 * whatever code that server was started with, which can be days old. That
 * failure mode is near-impossible to spot from the test output: everything
 * simply behaves as if your changes were never made. A dedicated port plus a
 * fresh server every run removes the ambiguity.
 */
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // The suite hits a real Groq-backed API on some pages; one retry absorbs a
  // transient upstream blip without hiding a genuine regression.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use the full Chromium build rather than the separate
        // chrome-headless-shell download, so `npx playwright install chromium`
        // alone is enough to run the suite.
        channel: "chromium",
      },
    },
  ],
});
