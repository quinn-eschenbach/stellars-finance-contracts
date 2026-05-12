import { test, expect } from "@playwright/test";
import { installApiMocks, DEFAULT_MARKETS } from "../fixtures/api-mocks";
import { setWalletState } from "../fixtures/wallet";

test.describe("Markets list", () => {
  test.beforeEach(async ({ page }) => {
    await setWalletState(page, "missing");
  });

  test("lists every market the API returns", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/markets");
    for (const m of DEFAULT_MARKETS) {
      await expect(page.getByText(m.symbol).first()).toBeVisible();
    }
  });

  test("shows the live-count pill matching the markets length", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/markets");
    await expect(page.getByText(`${DEFAULT_MARKETS.length} live`)).toBeVisible();
  });

  test("renders the error block when the markets endpoint fails", async ({ page }) => {
    await page.route("**/api/markets", (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
    await page.route("**/api/prices", (route) =>
      route.fulfill({ status: 200, body: "[]" }),
    );
    await page.route("**/api/stream/**", (route) => route.fulfill({ status: 200, body: "" }));
    await page.goto("/markets");
    await expect(page.getByText("Failed to load markets.")).toBeVisible();
  });

  test("market cards link through to /trade/:symbol", async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/markets");
    // Find the link inside the BTCUSD card. There are several text matches
    // for BTCUSD (header + card body); filter to one that's a clickable
    // anchor pointing at /trade/BTCUSD.
    const link = page.locator('a[href="/trade/BTCUSD"]').first();
    await expect(link).toBeVisible();
  });
});
