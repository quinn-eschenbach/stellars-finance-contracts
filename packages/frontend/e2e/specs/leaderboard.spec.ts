import { test, expect } from "@playwright/test";
import { installApiMocks } from "../fixtures/api-mocks";
import { setWalletState } from "../fixtures/wallet";
import { trader } from "../fixtures/trader";

const TRADERS = [
  {
    trader: trader("TEST1"),
    realized_pnl: "150000000000", // $15,000
    volume: "5000000000000",
    closes: 12,
    wins: 9,
    losses: 3,
    last_trade_at: 1700000000,
    open_positions: [],
  },
  {
    trader: trader("TEST2"),
    realized_pnl: "-25000000000", // -$2,500
    volume: "1000000000000",
    closes: 8,
    wins: 2,
    losses: 6,
    last_trade_at: 1700000100,
    open_positions: [],
  },
];

test.describe("Leaderboard", () => {
  test.beforeEach(async ({ page }) => {
    await setWalletState(page, "missing");
  });

  test("renders one row per trader returned by /leaderboard", async ({ page }) => {
    await installApiMocks(page, { leaderboard: TRADERS });
    await page.goto("/leaderboard");
    await expect(page.getByText(/2 traders/)).toBeVisible();
    // Both traders' short addresses end with the last 4 chars.
    await expect(page.getByText(/EST1$/)).toBeVisible();
    await expect(page.getByText(/EST2$/)).toBeVisible();
  });

  test("shows the empty state when there are no traders", async ({ page }) => {
    await installApiMocks(page, { leaderboard: [] });
    await page.goto("/leaderboard");
    await expect(page.getByText(/0 traders/)).toBeVisible();
  });

  test("renders the error block when leaderboard fetch fails", async ({ page }) => {
    await installApiMocks(page);
    // Override after installApiMocks to fail with a 500.
    await page.route("**/api/leaderboard*", (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
    await page.goto("/leaderboard");
    await expect(page.getByText(/Failed to load leaderboard/)).toBeVisible();
  });
});
