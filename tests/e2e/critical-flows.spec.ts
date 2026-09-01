import { test, expect } from "@playwright/test";

test.describe("Home — Crowd Forecast", () => {
  test("date picker and forecast button render", async ({ page }) => {
    await page.goto("/");
    // DisneyDatePicker is a button-based picker, not a native date input; the
    // previous `input[type="date"]` selector matched nothing.
    await expect(page.getByRole("button", { name: /change date/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /forecast/i })).toBeVisible();
  });

  test("nav links are all present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Forecast" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Wait Times" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Accuracy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
  });
});

test.describe("Chat page", () => {
  test("chat input and send button render", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.locator("input[placeholder*='wait times']")).toBeVisible();
    await expect(page.getByRole("button", { name: /send/i })).toBeVisible();
  });

  test("send button disabled when input is empty", async ({ page }) => {
    await page.goto("/chat");
    const btn = page.getByRole("button", { name: /send/i });
    await expect(btn).toBeDisabled();
  });
});

test.describe("Wait Times page", () => {
  // This spec previously described an hour-selector UI that belonged to an
  // earlier version of the page. The page now loads predictions for the
  // selected date automatically, with no submit button.
  test("heading and date picker render", async ({ page }) => {
    await page.goto("/wait-times");
    await expect(
      page.getByRole("heading", { name: /Wait Time Predictions/i })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /change date/i })).toBeVisible();
  });

  test("accepts a date from the query string", async ({ page }) => {
    await page.goto("/wait-times?date=2026-07-04");
    await expect(
      page.getByRole("button", { name: /change date, currently July 4, 2026/i })
    ).toBeVisible();
  });

  test("falls back to a valid date when the query string is nonsense", async ({ page }) => {
    await page.goto("/wait-times?date=not-a-date");
    await expect(
      page.getByRole("button", { name: /change date, currently \w+ \d{1,2}, \d{4}/i })
    ).toBeVisible();
  });

  test("resolves to a terminal state rather than hanging on the spinner", async ({ page }) => {
    await page.goto("/wait-times");
    // Table, empty-state or error — any is fine; a permanent spinner is not.
    await expect(
      page.locator("table, text=/No per-ride predictions/, text=/Couldn.t load/")
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Calendar page", () => {
  test("renders the month grid and the crowd legend", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: /Crowd Calendar/i })).toBeVisible();
    // Weekday header row proves the grid rendered, not just the shell.
    await expect(page.getByText("Sun", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Light \(0–25\)/)).toBeVisible();
  });

  test("legend thresholds match the shared crowd scale", async ({ page }) => {
    // Guards the split that had the calendar on 30/55/75 and lib/crowd.ts on
    // 25/50/75, so one day could carry two different labels.
    await page.goto("/calendar");
    for (const range of ["Light (0–25)", "Moderate (26–50)", "Busy (51–75)", "Very Busy (76+)"]) {
      await expect(page.getByText(range)).toBeVisible();
    }
  });

  test("next/previous month buttons change the displayed month", async ({ page }) => {
    await page.goto("/calendar");

    const monthLabel = page.locator("p.font-display").first();
    const initial = await monthLabel.textContent();

    await page.getByRole("button", { name: "Next month" }).click();
    await expect(monthLabel).not.toHaveText(initial ?? "");

    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(monthLabel).toHaveText(initial ?? "");
  });
});

test.describe("Accuracy page", () => {
  test("accuracy page loads without error", async ({ page }) => {
    await page.goto("/accuracy");
    await expect(page.getByRole("heading", { name: /Prediction Accuracy/i })).toBeVisible();
  });
});
