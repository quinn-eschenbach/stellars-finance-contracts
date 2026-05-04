import { pgTable, pgView, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const oraclePrices = pgTable("oracle_prices", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  symbol: text().notNull(),
  price: numeric().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});

/**
 * One row per symbol carrying the most recently inserted price observation
 * (selected by `MAX(id)` since the id is monotonic). Both the indexer's
 * `PriceFetch` event handler and the poller's read-only simulation feed
 * `oracle_prices`; this view conflates them into "latest known price" for
 * read-side consumers without each one re-deriving the SQL.
 */
export const latestOraclePrices = pgView("latest_oracle_prices", {
  id: integer().notNull(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  symbol: text().notNull(),
  price: numeric().notNull(),
}).as(sql`SELECT id, ledger, timestamp, symbol, price FROM oracle_prices WHERE id IN (SELECT MAX(id) FROM oracle_prices GROUP BY symbol)`);
