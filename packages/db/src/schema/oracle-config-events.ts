import { pgTable, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const oracleConfigEvents = pgTable("oracle_config_events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  staleness: numeric().notNull(),
  deviation: numeric().notNull(),
  cache_duration: numeric().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
