import { pgTable, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const lpTransfers = pgTable("lp_transfers", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  from: text().notNull(),
  to: text().notNull(),
  to_muxed_id: numeric(),
  amount: numeric().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
