import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";

export const indexerCursor = pgTable("indexer_cursor", {
  id: integer().primaryKey().default(1),
  last_ledger: integer().notNull().default(0),
  last_cursor: text().notNull().default(""),
  updated_at: timestamp().defaultNow().notNull(),
});
