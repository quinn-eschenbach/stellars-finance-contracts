import { pgTable, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const markets = pgTable("markets", {
  symbol: text().primaryKey(),
  global_long_avg_price: numeric().notNull().default("0"),
  global_short_avg_price: numeric().notNull().default("0"),
  long_open_interest: numeric().notNull().default("0"),
  short_open_interest: numeric().notNull().default("0"),
  acc_borrow_index: numeric().notNull().default("0"),
  acc_funding_index: numeric().notNull().default("0"),
  last_index_update: numeric().notNull().default("0"),
  max_leverage: numeric().notNull().default("0"),
  market_unrealized_pnl: numeric().notNull().default("0"),
  updated_at_ledger: integer().notNull().default(0),
  updated_at: timestamp().defaultNow().notNull(),
});
