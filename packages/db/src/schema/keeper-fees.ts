import { pgTable, text, numeric, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * One row per successful keeper submission, recording the realised on-chain
 * fee the keeper paid for that transaction. Append-only audit log; nothing
 * updates rows after insert.
 *
 * `symbol` and `trader` are nullable because not every op carries both —
 * `update_indices` has a symbol but no trader, while every other op carries
 * both.
 */
export const keeperFees = pgTable(
  "keeper_fees",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    tx_hash: text().notNull(),
    ledger: integer().notNull(),
    timestamp: numeric().notNull(),
    op_type: text().notNull(),
    symbol: text(),
    trader: text(),
    fee_charged_stroops: numeric().notNull(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (t) => [
    index("keeper_fees_op_type_timestamp_idx").on(t.op_type, t.timestamp),
    index("keeper_fees_tx_hash_idx").on(t.tx_hash),
  ],
);
