import { test, expect } from "@playwright/test";
import { installApiMocks } from "../fixtures/api-mocks";
import { setWalletState } from "../fixtures/wallet";
import { trader } from "../fixtures/trader";

const TRADER = trader("TESTX");

test.describe("Portfolio page", () => {
  test("prompts to connect when no wallet is attached", async ({ page }) => {
    await setWalletState(page, "missing");
    await installApiMocks(page);
    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { name: /no wallet/i })).toBeVisible();
    await expect(page.getByText(/connect a freighter wallet/i)).toBeVisible();
  });

  test("shows 'No open positions' when the trader has none", async ({ page }) => {
    await setWalletState(page, "connected", { address: TRADER });
    await installApiMocks(page, { positions: { [TRADER]: [] } });
    await page.goto("/portfolio");
    await expect(page.getByText(/No open positions/i)).toBeVisible();
    await expect(page.getByText(/0 open positions/i)).toBeVisible();
  });

  test("renders a position row when the trader has one", async ({ page }) => {
    const pos = {
      id: 1,
      trader: TRADER,
      symbol: "BTCUSD",
      collateral: "10000000000",
      size: "100000000000",
      entry_price: "950000000000",
      entry_borrow_index: "0",
      entry_funding_index: "0",
      is_long: true,
      last_increased_time: "1700000000",
      take_profit: "0",
      stop_loss: "0",
      updated_at_ledger: 1,
      updated_at_tx: "tx",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    await setWalletState(page, "connected", { address: TRADER });
    await installApiMocks(page, { positions: { [TRADER]: [pos] } });
    await page.goto("/portfolio");
    await expect(page.getByText(/1 open position\b/i)).toBeVisible();
    await expect(page.getByText("BTCUSD").first()).toBeVisible();
  });
});
