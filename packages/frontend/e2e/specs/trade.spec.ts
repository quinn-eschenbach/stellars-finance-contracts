import { test, expect } from "@playwright/test";
import { installApiMocks, DEFAULT_MARKETS, DEFAULT_PRICES } from "../fixtures/api-mocks";
import { setWalletState } from "../fixtures/wallet";
import { expectNumberFlowValue } from "../fixtures/matchers";
import { trader } from "../fixtures/trader";

const TRADER = trader("TRADR");

test.describe("Trade page", () => {
  test("renders the symbol header and mark price", async ({ page }) => {
    await setWalletState(page, "missing");
    await installApiMocks(page);
    await page.goto("/trade/BTCUSD");
    // Symbol appears in the header.
    await expect(page.getByText("BTCUSD").first()).toBeVisible();
    // Mark price ($95,000) — read the NumberFlow's prop directly because the
    // formatted output lives in Shadow DOM.
    await expectNumberFlowValue(page, 95_000);
  });

  test("shows the order form with Long / Short controls", async ({ page }) => {
    await setWalletState(page, "connected", { address: TRADER });
    await installApiMocks(page, { positions: { [TRADER]: [] } });
    await page.goto("/trade/BTCUSD");
    // SideToggle is two <button>s, not ARIA tabs.
    await expect(page.getByRole("button", { name: /^long$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^short$/i })).toBeVisible();
  });

  test("falls back to a 'select a market' / blank state on unknown symbol", async ({ page }) => {
    await setWalletState(page, "missing");
    await installApiMocks(page);
    await page.goto("/trade/NOPESYMBOL");
    // The market endpoint will 404; the page handles it without crashing —
    // we just check the header/nav still rendered.
    await expect(page.locator("header").first()).toBeVisible();
  });

  test("renders bias gauge from the OI split", async ({ page }) => {
    await setWalletState(page, "missing");
    // BTCUSD has 120 long / 80 short in DEFAULT_MARKETS → 60% long → Bullish.
    await installApiMocks(page);
    await page.goto("/trade/BTCUSD");
    await expect(page.getByText(/60% long/i).first()).toBeVisible();
  });

  test("doesn't render the bias gauge as 'Bullish' for a bear-heavy market", async ({ page }) => {
    // 20 long / 80 short → 20% long → Bearish.
    await setWalletState(page, "missing");
    await installApiMocks(page, {
      markets: [
        {
          ...DEFAULT_MARKETS[0],
          symbol: "FLIP",
          long_open_interest: (20n * 10_000_000n).toString(),
          short_open_interest: (80n * 10_000_000n).toString(),
        },
      ],
      prices: [{ ...DEFAULT_PRICES[0], symbol: "FLIP" }],
    });
    await page.goto("/trade/FLIP");
    await expect(page.getByText(/Bearish/i).first()).toBeVisible();
  });
});
