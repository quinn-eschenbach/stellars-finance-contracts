import { pgTable, text, numeric, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const roleEvents = pgTable("role_events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  role: text().notNull(),
  account: text().notNull(),
  is_grant: boolean().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
