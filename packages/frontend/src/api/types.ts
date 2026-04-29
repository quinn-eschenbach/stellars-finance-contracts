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
  updated_at_ledger: number;
  updated_at: string;
}

export interface PriceRow {
  symbol: string;
  price: string;
  ledger: number;
  timestamp: string;
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
  keeper: string | null;
  created_at: string;
}
