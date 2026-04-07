import { pgTable, text, numeric, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const pauseEvents = pgTable("pause_events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  contract: text().notNull(), // "vault" | "position_manager"
  is_paused: boolean().notNull(),
  caller: text().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
