import { pgTable, text, numeric, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const trades = pgTable("trades", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  trader: text().notNull(),
  symbol: text().notNull(),
  event_type: text().notNull(), // increase, decrease, liquidation, order, adl
  size_delta: numeric().notNull(),
  collateral_delta: numeric().notNull().default("0"),
  entry_price: numeric().notNull().default("0"),
  mark_price: numeric().notNull().default("0"),
  pnl: numeric().notNull().default("0"),
  borrow_fee: numeric().notNull().default("0"),
  funding_fee: numeric().notNull().default("0"),
  is_long: boolean(),
  is_full_close: boolean(),
  is_tp: boolean(),
  keeper: text(),
  created_at: timestamp().defaultNow().notNull(),
});
