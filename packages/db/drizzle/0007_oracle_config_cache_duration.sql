-- Restore the `cache_duration` column on oracle_config_events. The OracleRouter
-- now caches aggregated prices for `cache_duration` seconds again — each
-- on-chain config event includes the duration, and this column captures it
-- alongside the existing `min_required_sources` quorum field.
--
-- Existing rows (from before the cache was reintroduced) cannot be back-filled
-- with a meaningful value; default to 0 so the column can be NOT NULL.

ALTER TABLE oracle_config_events ADD COLUMN cache_duration numeric NOT NULL DEFAULT 0;
ALTER TABLE oracle_config_events ALTER COLUMN cache_duration DROP DEFAULT;
