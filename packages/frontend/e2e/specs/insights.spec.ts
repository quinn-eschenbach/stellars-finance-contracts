import { test, expect } from "@playwright/test";
import { installApiMocks } from "../fixtures/api-mocks";
import { setWalletState } from "../fixtures/wallet";

test.describe("Insights (hidden internal dashboard)", () => {
  test.beforeEach(async ({ page }) => {
    await setWalletState(page, "missing");
    await installApiMocks(page);
  });

  test("renders the protocol overview section", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.getByText(/protocol overview/i)).toBeVisible();
    await expect(page.getByText(/TVL/i).first()).toBeVisible();
  });

  test("renders without crashing when no markets are returned", async ({ page }) => {
    await installApiMocks(page, { markets: [], prices: [] });
    await page.goto("/insights");
    // Header should still render even with an empty workspace.
    await expect(page.getByText(/Beneath/i)).toBeVisible();
  });
});
