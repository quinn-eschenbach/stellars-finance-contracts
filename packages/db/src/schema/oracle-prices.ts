import { pgTable, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const oraclePrices = pgTable("oracle_prices", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  symbol: text().notNull(),
  price: numeric().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
