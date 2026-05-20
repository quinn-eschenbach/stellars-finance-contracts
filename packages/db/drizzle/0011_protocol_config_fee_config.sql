-- Mirror ConfigManager FeeConfig into protocol_config so the off-chain
-- IncreaseQuote derivation (and the existing /config endpoint) can read
-- open_fee_bps + liquidation_bounty_bps + tp_sl_execution_fee without an
-- extra contract simulation per page load. Populated by the indexer's
-- `feecnf` event handler.

ALTER TABLE "protocol_config" ADD COLUMN "open_fee_bps" integer DEFAULT 0 NOT NULL;
ALTER TABLE "protocol_config" ADD COLUMN "liquidation_bounty_bps" integer DEFAULT 0 NOT NULL;
ALTER TABLE "protocol_config" ADD COLUMN "tp_sl_execution_fee" numeric DEFAULT '0' NOT NULL;
