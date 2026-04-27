import { pgTable, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";

export const indexerCursor = pgTable("indexer_cursor", {
  id: integer().primaryKey().default(1),
  last_ledger: integer().notNull().default(0),
  last_cursor: text().notNull().default(""),
  // Unix seconds of the most-recently-observed ledger close. Distinct from
  // updated_at (which tracks indexer-poll wall time) — this lets keepers
  // distinguish "indexer alive, chain stalled" from "indexer dead".
  last_ledger_close_time: numeric().notNull().default("0"),
  updated_at: timestamp().defaultNow().notNull(),
});
