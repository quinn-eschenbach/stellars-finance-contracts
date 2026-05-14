import { pgTable, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const oracleConfigEvents = pgTable("oracle_config_events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  staleness: numeric().notNull(),
  deviation: numeric().notNull(),
  // OracleRouter has no price cache — emits `min_required_sources` (the
  // quorum threshold a price fetch must satisfy) in place of any
  // cache-duration field.
  min_required_sources: integer().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
