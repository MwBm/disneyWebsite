import { test, expect } from "@playwright/test";

test.describe("Mobile nav — hamburger menu", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("desktop links hidden, hamburger visible at mobile width", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /open menu/i })).toBeVisible();
    // Desktop link list should be hidden
    const desktopList = page.locator("nav ul.hidden");
    await expect(desktopList).toBeAttached();
  });

  test("hamburger opens and closes menu", async ({ page }) => {
    await page.goto("/");
    const hamburger = page.getByRole("button", { name: /open menu/i });
    await hamburger.click();

    // Mobile menu should now be open
    await expect(page.getByRole("button", { name: /close menu/i })).toBeVisible();
    // All nav links should be visible in mobile menu
    await expect(page.getByRole("link", { name: "Forecast" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Chat" }).first()).toBeVisible();

    // Close it
    await page.getByRole("button", { name: /close menu/i }).click();
    await expect(page.getByRole("button", { name: /open menu/i })).toBeVisible();
  });

  test("Escape key closes the mobile menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(page.getByRole("button", { name: /close menu/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /open menu/i })).toBeVisible();
  });

  test("clicking a nav link closes the menu and navigates", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /open menu/i }).click();
    await page.getByRole("link", { name: "Chat" }).first().click();

    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByRole("button", { name: /open menu/i })).toBeVisible();
  });
});
