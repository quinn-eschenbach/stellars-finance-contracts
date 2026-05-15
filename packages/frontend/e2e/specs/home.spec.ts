import { test, expect } from "@playwright/test";
import { installApiMocks } from "../fixtures/api-mocks";
import { setWalletState } from "../fixtures/wallet";
import { expectScaledValue } from "../fixtures/matchers";

test.describe("Home", () => {
  test.beforeEach(async ({ page }) => {
    await setWalletState(page, "missing");
    await installApiMocks(page);
  });

  test("renders the hero, stats strip, and featured markets", async ({ page }) => {
    await page.goto("/");
    // Hero copy
    await expect(page.locator("header").getByText(/Stellars/i)).toBeVisible();
    // Featured markets section pulls in the mocked symbols
    await expect(page.getByText("BTCUSD").first()).toBeVisible();
    await expect(page.getByText("ETHUSD").first()).toBeVisible();
  });

  test("offers a Connect Wallet CTA when nothing is connected", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
  });

  test("shows TVL pulled from the vault endpoint", async ({ page }) => {
    const totalAssets = 1_234_567n * 10_000_000n;
    await installApiMocks(page, {
      vault: {
        id: 1,
        total_assets: totalAssets.toString(),
        total_shares: "0",
        reserved_usdc: "0",
        unclaimed_fees: "0",
        net_global_trader_pnl: "0",
        free_liquidity: "0",
        is_paused: false,
        last_unpause_time: "0",
        updated_at_ledger: 1,
        updated_at: "2024-01-01T00:00:00Z",
      },
    });
    await page.goto("/");
    await expectScaledValue(page, totalAssets);
  });
});
