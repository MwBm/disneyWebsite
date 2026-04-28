import { test, expect } from "@playwright/test";

test.describe("Home — Crowd Forecast", () => {
  test("date picker and forecast button render", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('input[type="date"]')).toBeVisible();
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
  test("date, hour pickers and show predictions button render", async ({ page }) => {
    await page.goto("/wait-times");
    await expect(page.locator('input[type="date"]')).toBeVisible();
    await expect(page.locator("select")).toBeVisible();
    await expect(page.getByRole("button", { name: /show predictions/i })).toBeVisible();
  });
});

test.describe("Accuracy page", () => {
  test("accuracy page loads without error", async ({ page }) => {
    await page.goto("/accuracy");
    await expect(page.getByRole("heading", { name: /Prediction Accuracy/i })).toBeVisible();
  });
});
