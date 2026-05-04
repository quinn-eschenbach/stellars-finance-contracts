import { pgTable, integer, numeric, timestamp } from "drizzle-orm/pg-core";

export const protocolConfig = pgTable("protocol_config", {
  id: integer().primaryKey().default(1),
  // Fee splits
  keeper_bps: integer().notNull().default(0),
  dev_bps: integer().notNull().default(0),
  lp_bps: integer().notNull().default(0),
  // Protocol limits
  min_collateral: numeric().notNull().default("0"),
  cooldown_duration: numeric().notNull().default("0"),
  min_position_lifetime: numeric().notNull().default("0"),
  max_utilization_ratio: numeric().notNull().default("0"),
  funding_cut_bps: integer().notNull().default(0),
  adl_pnl_bps: integer().notNull().default(0),
  adl_utilization_bps: integer().notNull().default(0),
  liquidation_threshold_bps: integer().notNull().default(0),
  // Borrow rate config
  base_borrow_rate_bps: numeric().notNull().default("0"),
  slope1_bps: numeric().notNull().default("0"),
  slope2_bps: numeric().notNull().default("0"),
  optimal_utilization_bps: numeric().notNull().default("0"),
  base_funding_rate_bps: numeric().notNull().default("0"),
  // Last on-chain unpause timestamp (unix seconds). Off-chain MarketTick
  // projection clamps fee accrual using max(last_index_update, last_unpause_time)
  // so projected indices match what an immediate on-chain refresh would produce.
  last_unpause_time: numeric().notNull().default("0"),
  // Metadata
  updated_at_ledger: integer().notNull().default(0),
  updated_at: timestamp().defaultNow().notNull(),
});
