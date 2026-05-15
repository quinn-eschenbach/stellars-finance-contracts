import { test, expect } from "@playwright/test";
import { installApiMocks } from "../fixtures/api-mocks";
import { setWalletState } from "../fixtures/wallet";
import { trader } from "../fixtures/trader";

test.describe("Wallet connect", () => {
  test("the header CTA reflects extension state on first paint", async ({ page }) => {
    await setWalletState(page, "missing");
    await installApiMocks(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
  });

  test("clicking Connect Wallet (extension present, not allowed) updates UI to connected", async ({ page }) => {
    await setWalletState(page, "locked", {
      address: trader("OPENED"),
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    await installApiMocks(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();

    // Click — the mock's setAllowed flips state.allowed=true, then the
    // WalletProvider re-reads via refresh().
    await page.getByRole("button", { name: /connect wallet/i }).click();
    // Connected state: header shows the short address (last 4 chars "ENED"
    // from the trailing "OPENED" in the canned address).
    await expect(page.getByText(/…ENED$/)).toBeVisible({ timeout: 5_000 });
  });

  test("shows connected address + network when the wallet starts connected", async ({ page }) => {
    await setWalletState(page, "connected", {
      address: trader("READY"),
      network: "STANDALONE",
      networkPassphrase: "Standalone Network ; February 2017",
    });
    await installApiMocks(page);
    await page.goto("/");
    // Last 4 chars of the canned address are "EADY" (from "READY").
    await expect(page.getByText(/…EADY$/)).toBeVisible();
    await expect(page.getByText("STANDALONE")).toBeVisible();
  });
});
