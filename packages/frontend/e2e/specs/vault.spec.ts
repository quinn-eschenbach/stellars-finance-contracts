import { test, expect } from "@playwright/test";
import { installApiMocks, DEFAULT_VAULT } from "../fixtures/api-mocks";
import { setWalletState } from "../fixtures/wallet";
import { expectScaledValue } from "../fixtures/matchers";

test.describe("Vault page", () => {
  test("renders TVL, free liquidity, and reserved values from the API", async ({ page }) => {
    await setWalletState(page, "missing");
    await installApiMocks(page);
    await page.goto("/vault");

    // Three KPI cards: total_assets, free_liquidity, reserved_usdc.
    await expectScaledValue(page, DEFAULT_VAULT.total_assets);
    await expectScaledValue(page, DEFAULT_VAULT.free_liquidity);
    await expectScaledValue(page, DEFAULT_VAULT.reserved_usdc);
  });

  test("flags the paused state with a Paused pill", async ({ page }) => {
    await setWalletState(page, "missing");
    await installApiMocks(page, {
      vault: { ...DEFAULT_VAULT, is_paused: true },
    });
    await page.goto("/vault");
    await expect(page.getByText(/^Paused$/)).toBeVisible();
  });

  test("hides the paused pill when the vault is running", async ({ page }) => {
    await setWalletState(page, "missing");
    await installApiMocks(page);
    await page.goto("/vault");
    // First page render — no paused indicator.
    await expect(page.getByText(/^Paused$/)).toHaveCount(0);
  });
});
