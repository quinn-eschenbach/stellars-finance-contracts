import { pgTable, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const vaultState = pgTable("vault_state", {
  id: integer().primaryKey().default(1),
  total_assets: numeric().notNull().default("0"),
  total_shares: numeric().notNull().default("0"),
  reserved_usdc: numeric().notNull().default("0"),
  unclaimed_fees: numeric().notNull().default("0"),
  net_global_trader_pnl: numeric().notNull().default("0"),
  free_liquidity: numeric().notNull().default("0"),
  is_paused: boolean().notNull().default(false),
  updated_at_ledger: integer().notNull().default(0),
  updated_at: timestamp().defaultNow().notNull(),
});
