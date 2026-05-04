import { pgTable, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

// Vault → trader profit payments (post #3 cleanup: settle_pnl was renamed to
// pay_profit and the loss/reserved_delta branches dropped — see ADR-0001).
export const payProfitEvents = pgTable("pay_profit_events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  tx_hash: text().notNull(),
  ledger: integer().notNull(),
  timestamp: numeric().notNull(),
  trader: text().notNull(),
  amount: numeric().notNull(),
  created_at: timestamp().defaultNow().notNull(),
});
