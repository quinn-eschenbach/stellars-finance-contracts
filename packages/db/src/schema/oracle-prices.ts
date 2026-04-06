import { pgTable, text, numeric, integer, bigint, timestamp } from "drizzle-orm/pg-core";

export const oraclePrices = pgTable("oracle_prices", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  ledger: integer().notNull(),
  timestamp: bigint({ mode: "number" }).notNull(),
  symbol: text().notNull(),
  price: numeric().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
