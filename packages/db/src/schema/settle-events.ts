import { pgTable, text, numeric, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const settleEvents = pgTable("settle_events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  trader: text().notNull(),
  amount: numeric().notNull(),
  reserved_delta: numeric().notNull(),
  is_profit: boolean().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
