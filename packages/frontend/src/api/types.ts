/**
 * API response types — the contract between frontend and @stellars/api.
 * Defined here (not imported from @stellars/db) to keep the frontend bundle
 * free of pg/drizzle and to let the API/DB schemas evolve independently.
 *
 * Numeric strings are protocol-scaled (USDC × 10^7, prices × 10^7, indices
 * × 10^14) — passed through as strings to avoid bigint serialization issues
 * over JSON. Use lib/utils.ts formatters when displaying.
 */

export interface MarketRow {
  symbol: string;
  global_long_avg_price: string;
  global_short_avg_price: string;
  long_open_interest: string;
  short_open_interest: string;
  acc_borrow_index: string;
  acc_funding_index: string;
  last_index_update: string;
  max_leverage: string;
  market_unrealized_pnl: string;
  updated_at_ledger: number;
  updated_at: string;
}

export interface PositionRow {
  id: number;
  trader: string;
  symbol: string;
  collateral: string;
  size: string;
  entry_price: string;
  entry_borrow_index: string;
  entry_funding_index: string;
  is_long: boolean;
  last_increased_time: string;
  take_profit: string;
  stop_loss: string;
  updated_at_ledger: number;
  updated_at_tx: string;
  created_at: string;
  updated_at: string;
}

export interface VaultStateRow {
  id: number;
  total_assets: string;
  total_shares: string;
  reserved_usdc: string;
  unclaimed_fees: string;
  net_global_trader_pnl: string;
  free_liquidity: string;
  is_paused: boolean;
  /** Spliced in from protocol_config so the MarketTick projection has it. Unix seconds. */
  last_unpause_time: string;
  updated_at_ledger: number;
  updated_at: string;
}

/**
 * Protocol-wide config singleton from `/config`. The `BorrowRateConfig` slice
 * (base/slope/optimal/funding) is what `MarketTick.project()` consumes; the
 * fee/limit fields are exposed for completeness so future UI (admin panels,
 * insights drilldowns) doesn't need a second endpoint.
 */
export interface ProtocolConfigRow {
  id: number;
  // Fee splits (bps; sum to 10_000)
  keeper_bps: number;
  dev_bps: number;
  lp_bps: number;
  // Protocol limits (scaled bigints as strings)
  min_collateral: string;
  cooldown_duration: string;
  min_position_lifetime: string;
  max_utilization_ratio: string;
  funding_cut_bps: number;
  adl_pnl_bps: number;
  adl_utilization_bps: number;
  liquidation_threshold_bps: number;
  // Borrow / funding rate config (BPS as strings to mirror the contract i128)
  base_borrow_rate_bps: string;
  slope1_bps: string;
  slope2_bps: string;
  optimal_utilization_bps: string;
  base_funding_rate_bps: string;
  // Last on-chain unpause time (unix seconds)
  last_unpause_time: string;
  updated_at_ledger: number;
  updated_at: string;
}

/**
 * Rolling-window LP profitability snapshot from `/vault/profitability`.
 * Numbers are protocol-scaled (× 10^7) strings. `lp_net_from_trades` is
 * the inverse of trader PnL — positive when traders lost. `lp_net_from_fees`
 * is the LP slice of borrow + funding fees over the same window.
 */
export interface VaultProfitabilityRow {
  window_days: number;
  lp_net_from_trades: string;
  lp_net_from_fees: string;
  lp_bps: number;
  as_of: string;
}

export interface PriceRow {
  symbol: string;
  price: string;
  ledger: number;
  timestamp: string;
}

/**
 * OHLC candle synthesized server-side by bucketing oracle ticks.
 * Time is unix seconds (the bucket start). Prices are protocol-scaled
 * strings (× 10^7) — the chart converts to numbers for display.
 */
export interface CandleRow {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
}

export type CandleInterval = 60 | 300 | 900 | 3600 | 14400 | 86400;

export interface LeaderboardRow {
  trader: string;
  /** Sum of pnl across all trade events for this trader (USDC × 10^7). */
  realized_pnl: string;
  /** Sum of |size_delta| across trades — proxy for cumulative notional volume. */
  volume: string;
  /** Number of closing events (decrease/liquidation/order/adl). */
  closes: number;
  /** Closing events with positive pnl. */
  wins: number;
  /** Closing events with negative pnl. */
  losses: number;
  /** Unix-seconds timestamp of the latest trade event. */
  last_trade_at: number | null;
}

export interface TradeRow {
  id: number;
  tx_hash: string;
  ledger: number;
  timestamp: string;
  trader: string;
  symbol: string;
  event_type: "increase" | "decrease" | "liquidation" | "order" | "adl";
  size_delta: string;
  collateral_delta: string;
  entry_price: string;
  mark_price: string;
  pnl: string;
  borrow_fee: string;
  funding_fee: string;
  is_long: boolean | null;
  is_full_close: boolean | null;
  is_tp: boolean | null;
  executor: string | null;
  created_at: string;
}
