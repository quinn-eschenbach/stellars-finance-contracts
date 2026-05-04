-- Convert oracle_prices to a TimescaleDB hypertable for efficient
-- time-range queries (price history, candle aggregates). Keeps Postgres
-- protocol/SQL semantics; only this one table is partitioned.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Hypertables require the partition column to appear in every UNIQUE
-- constraint, so the id-only PK is replaced with (id, created_at).
ALTER TABLE "oracle_prices" DROP CONSTRAINT "oracle_prices_pkey";
ALTER TABLE "oracle_prices" ADD CONSTRAINT "oracle_prices_pkey" PRIMARY KEY ("id", "created_at");

-- SSE notification handler does point lookups by id; keep them O(log n).
-- IDENTITY sequence already guarantees id uniqueness, so a non-unique
-- btree is sufficient (and Timescale would reject a unique one anyway).
CREATE INDEX IF NOT EXISTS "oracle_prices_id_idx" ON "oracle_prices" ("id");

-- migrate_data => TRUE moves any pre-existing rows into chunks. Cheap on
-- empty tables; safe on populated dev/staging instances.
SELECT create_hypertable('oracle_prices', 'created_at', migrate_data => TRUE);
