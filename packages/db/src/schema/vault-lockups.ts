import { pgTable, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const vaultLockups = pgTable("vault_lockups", {
  user: text().primaryKey(),
  expires_at: numeric().notNull(),
  updated_at_ledger: integer().notNull().default(0),
  updated_at: timestamp().defaultNow().notNull(),
});
