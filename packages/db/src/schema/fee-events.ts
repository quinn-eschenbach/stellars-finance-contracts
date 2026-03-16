import { pgTable, text, numeric, integer, bigint, timestamp } from "drizzle-orm/pg-core";

export const feeEvents = pgTable("fee_events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: bigint({ mode: "bigint" }).notNull(),
  event_type: text().notNull(), // accrue, claim
  amount: numeric().notNull(),
  recipient: text(),
  created_at: timestamp().defaultNow().notNull(),
});
