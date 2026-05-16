-- Rename protocol_config.keeper_bps -> staker_bps. The on-chain FeeSplits
-- struct now partitions revenue between {lp, dev, staker} -- the keeper
-- slice that used to live here was conceptually mislabelled (keepers are
-- paid via execution bounties out of FeeConfig, not from the revenue
-- split). Aligning the column name with the contract event payload
-- (FeeSplitsUpdate.staker_bps) prevents the indexer from silently
-- dropping the value on insert.

ALTER TABLE protocol_config RENAME COLUMN keeper_bps TO staker_bps;
