import { pgTable, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const vaultEvents = pgTable("vault_events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  event_type: text().notNull(), // deposit, withdraw (mint→deposit, redeem→withdraw via OZ)
  user: text().notNull(),
  assets: numeric().notNull(),
  shares: numeric().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
