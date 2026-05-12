import { test, expect } from "@playwright/test";
import { installApiMocks } from "../fixtures/api-mocks";
import { setWalletState } from "../fixtures/wallet";

test.describe("Faucet", () => {
  test("renders the mint form and preset amount buttons", async ({ page }) => {
    await setWalletState(page, "connected");
    await installApiMocks(page);
    await page.goto("/faucet");
    await expect(page.getByRole("heading", { name: /faucet/i })).toBeVisible();
    // Three preset amount chips: 100, 1000, 10000. Use exact match so the
    // "Mint 1000 USDC" submit button doesn't get pulled in by substring.
    await expect(page.getByRole("button", { name: "100", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "1000", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "10000", exact: true })).toBeVisible();
  });

  test("amount input updates when a preset is clicked", async ({ page }) => {
    await setWalletState(page, "connected");
    await installApiMocks(page);
    await page.goto("/faucet");
    await page.getByRole("button", { name: "10000", exact: true }).click();
    // The text input echoing the preset value.
    await expect(page.locator("input[type='text']")).toHaveValue("10000");
  });
});
