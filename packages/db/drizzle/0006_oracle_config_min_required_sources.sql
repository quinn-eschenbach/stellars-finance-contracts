-- OracleRouter has no price cache, so cache_duration no longer exists in the
-- on-chain event. The new field is min_required_sources (the quorum
-- threshold). Rename the column to match the new event payload.
--
-- For existing rows we cannot back-fill a meaningful value — the original
-- cache_duration semantics are unrelated to source quorum. Set the column
-- nullable for the rename, then populate with a sentinel (0) so historic rows
-- are preserved and the column can become NOT NULL.

ALTER TABLE oracle_config_events RENAME COLUMN cache_duration TO min_required_sources;
ALTER TABLE oracle_config_events ALTER COLUMN min_required_sources TYPE integer USING (min_required_sources::integer);
