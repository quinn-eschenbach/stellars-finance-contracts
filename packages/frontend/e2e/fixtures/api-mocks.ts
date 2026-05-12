import type { Page, Route } from "@playwright/test";
import type {
  MarketRow,
  PositionRow,
  VaultStateRow,
  ProtocolConfigRow,
  PriceRow,
  CandleRow,
  LeaderboardRow,
  TradeRow,
} from "@/api/types";

/**
 * Canned API payloads + a route-installer. Each test does:
 *   `await installApiMocks(page, { markets: [...], prices: [...] })`
 * before the first navigation. Anything not supplied falls back to the
 * defaults below, so a test that only cares about one endpoint stays terse.
 *
 * Payloads are typed against `@/api/types` — the same contract the frontend
 * uses for real responses — so if the API shape drifts, these fixtures fail
 * to compile rather than silently serving stale data.
 */

const SCALE = 10_000_000n;
const s = (b: bigint) => b.toString();

export const DEFAULT_MARKETS: MarketRow[] = [
  {
    symbol: "BTCUSD",
    global_long_avg_price: s(95_000n * SCALE),
    global_short_avg_price: s(95_000n * SCALE),
    long_open_interest: s(120n * SCALE),
    short_open_interest: s(80n * SCALE),
    acc_borrow_index: "0",
    acc_funding_index: "0",
    last_index_update: "1700000000",
    max_leverage: "100",
    market_unrealized_pnl: "0",
    updated_at_ledger: 1,
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    symbol: "ETHUSD",
    global_long_avg_price: s(3_500n * SCALE),
    global_short_avg_price: s(3_500n * SCALE),
    long_open_interest: s(50n * SCALE),
    short_open_interest: s(60n * SCALE),
    acc_borrow_index: "0",
    acc_funding_index: "0",
    last_index_update: "1700000000",
    max_leverage: "50",
    market_unrealized_pnl: "0",
    updated_at_ledger: 1,
    updated_at: "2024-01-01T00:00:00Z",
  },
];

export const DEFAULT_PRICES: PriceRow[] = [
  { symbol: "BTCUSD", price: s(95_000n * SCALE), ledger: 100, timestamp: "1700000000" },
  { symbol: "ETHUSD", price: s(3_500n * SCALE), ledger: 100, timestamp: "1700000000" },
];

export const DEFAULT_VAULT: VaultStateRow = {
  id: 1,
  total_assets: s(10_000_000n * SCALE),
  total_shares: s(10_000_000n * SCALE),
  reserved_usdc: s(500_000n * SCALE),
  unclaimed_fees: "0",
  net_global_trader_pnl: "0",
  free_liquidity: s(9_500_000n * SCALE),
  is_paused: false,
  last_unpause_time: "0",
  updated_at_ledger: 1,
  updated_at: "2024-01-01T00:00:00Z",
};

export const DEFAULT_CONFIG: ProtocolConfigRow = {
  id: 1,
  keeper_bps: 1000,
  dev_bps: 2000,
  lp_bps: 7000,
  min_collateral: s(10n * SCALE),
  cooldown_duration: "0",
  min_position_lifetime: "0",
  max_utilization_ratio: "8500",
  funding_cut_bps: 1000,
  adl_pnl_bps: 0,
  adl_utilization_bps: 0,
  liquidation_threshold_bps: 9500,
  base_borrow_rate_bps: "100",
  slope1_bps: "500",
  slope2_bps: "5000",
  optimal_utilization_bps: "8000",
  base_funding_rate_bps: "100",
  last_unpause_time: "0",
  updated_at_ledger: 1,
  updated_at: "2024-01-01T00:00:00Z",
};

export interface ApiMocks {
  markets?: MarketRow[];
  prices?: PriceRow[];
  vault?: VaultStateRow | null;
  config?: ProtocolConfigRow;
  positions?: Record<string, PositionRow[]>;
  trades?: TradeRow[];
  leaderboard?: LeaderboardRow[];
  candles?: CandleRow[];
}

const JSON_HEADERS = { "content-type": "application/json" };

export async function installApiMocks(page: Page, overrides: ApiMocks = {}) {
  const markets = overrides.markets ?? DEFAULT_MARKETS;
  const prices = overrides.prices ?? DEFAULT_PRICES;
  const vault = overrides.vault === undefined ? DEFAULT_VAULT : overrides.vault;
  const config = overrides.config ?? DEFAULT_CONFIG;
  const positions = overrides.positions ?? {};
  const trades = overrides.trades ?? [];
  const leaderboard = overrides.leaderboard ?? [];
  const candles = overrides.candles ?? [];

  async function json(route: Route, body: unknown, status = 200) {
    await route.fulfill({ status, headers: JSON_HEADERS, body: JSON.stringify(body) });
  }

  await page.route("**/api/markets", (route) => json(route, markets));
  await page.route(/\/api\/markets\/[^/]+$/, (route) => {
    const symbol = decodeURIComponent(route.request().url().split("/").pop()!);
    const row = markets.find((m) => m.symbol === symbol);
    return row ? json(route, row) : json(route, { error: "not_found" }, 404);
  });
  await page.route("**/api/prices", (route) => json(route, prices));
  await page.route(/\/api\/prices\/[^/]+\/candles.*/, (route) => json(route, candles));
  await page.route("**/api/vault", (route) =>
    vault === null ? json(route, { error: "not_found" }, 404) : json(route, vault),
  );
  await page.route("**/api/config", (route) => json(route, config));
  await page.route("**/api/leaderboard*", (route) => json(route, leaderboard));
  await page.route("**/api/trades*", (route) => json(route, trades));
  await page.route(/\/api\/positions\/[^/]+$/, (route) => {
    const trader = decodeURIComponent(route.request().url().split("/").pop()!);
    return json(route, positions[trader] ?? []);
  });

  // SSE endpoints — keep the request open with no events so the EventSource
  // stays connected without polluting the cache. Tests that care about SSE
  // can override individual routes after this.
  await page.route("**/api/stream/**", (route) => {
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body: "",
    });
  });
}
