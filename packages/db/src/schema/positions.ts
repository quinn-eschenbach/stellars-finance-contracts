import { pgTable, text, numeric, boolean, integer, bigint, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const positions = pgTable(
  "positions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    trader: text().notNull(),
    symbol: text().notNull(),
    collateral: numeric().notNull(),
    size: numeric().notNull(),
    entry_price: numeric().notNull(),
    entry_borrow_index: numeric().notNull(),
    entry_funding_index: numeric().notNull(),
    is_long: boolean().notNull(),
    last_increased_time: bigint({ mode: "number" }).notNull(),
    take_profit: numeric().notNull().default("0"),
    stop_loss: numeric().notNull().default("0"),
    updated_at_ledger: integer().notNull(),
    updated_at_tx: text().notNull(),
    created_at: timestamp().defaultNow().notNull(),
    updated_at: timestamp().defaultNow().notNull(),
  },
  (t) => [uniqueIndex("positions_trader_symbol_idx").on(t.trader, t.symbol)],
);
