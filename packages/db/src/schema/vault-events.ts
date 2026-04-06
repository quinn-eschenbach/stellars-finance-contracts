import { pgTable, text, numeric, integer, bigint, timestamp } from "drizzle-orm/pg-core";

export const vaultEvents = pgTable("vault_events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: bigint({ mode: "number" }).notNull(),
  event_type: text().notNull(), // deposit, withdraw, mint, redeem
  user: text().notNull(),
  assets: numeric().notNull(),
  shares: numeric().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
