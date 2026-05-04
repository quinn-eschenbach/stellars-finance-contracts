CREATE TABLE "fee_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fee_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tx_hash" text NOT NULL,
	"ledger" integer NOT NULL,
	"timestamp" numeric NOT NULL,
	"event_type" text NOT NULL,
	"amount" numeric NOT NULL,
	"recipient" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_cursor" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_ledger" integer DEFAULT 0 NOT NULL,
	"last_cursor" text DEFAULT '' NOT NULL,
	"last_ledger_close_time" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lp_transfers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lp_transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tx_hash" text NOT NULL,
	"ledger" integer NOT NULL,
	"timestamp" numeric NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"to_muxed_id" numeric,
	"amount" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"symbol" text PRIMARY KEY NOT NULL,
	"global_long_avg_price" numeric DEFAULT '0' NOT NULL,
	"global_short_avg_price" numeric DEFAULT '0' NOT NULL,
	"long_open_interest" numeric DEFAULT '0' NOT NULL,
	"short_open_interest" numeric DEFAULT '0' NOT NULL,
	"acc_borrow_index" numeric DEFAULT '0' NOT NULL,
	"acc_funding_index" numeric DEFAULT '0' NOT NULL,
	"last_index_update" numeric DEFAULT '0' NOT NULL,
	"max_leverage" numeric DEFAULT '0' NOT NULL,
	"market_unrealized_pnl" numeric DEFAULT '0' NOT NULL,
	"updated_at_ledger" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oracle_config_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oracle_config_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tx_hash" text NOT NULL,
	"ledger" integer NOT NULL,
	"timestamp" numeric NOT NULL,
	"staleness" numeric NOT NULL,
	"deviation" numeric NOT NULL,
	"cache_duration" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oracle_prices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oracle_prices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ledger" integer NOT NULL,
	"timestamp" numeric NOT NULL,
	"symbol" text NOT NULL,
	"price" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pause_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pause_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tx_hash" text NOT NULL,
	"ledger" integer NOT NULL,
	"timestamp" numeric NOT NULL,
	"contract" text NOT NULL,
	"is_paused" boolean NOT NULL,
	"caller" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_profit_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pay_profit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tx_hash" text NOT NULL,
	"ledger" integer NOT NULL,
	"timestamp" numeric NOT NULL,
	"trader" text NOT NULL,
	"amount" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "positions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trader" text NOT NULL,
	"symbol" text NOT NULL,
	"collateral" numeric NOT NULL,
	"size" numeric NOT NULL,
	"entry_price" numeric NOT NULL,
	"entry_borrow_index" numeric NOT NULL,
	"entry_funding_index" numeric NOT NULL,
	"is_long" boolean NOT NULL,
	"last_increased_time" numeric NOT NULL,
	"take_profit" numeric DEFAULT '0' NOT NULL,
	"stop_loss" numeric DEFAULT '0' NOT NULL,
	"updated_at_ledger" integer NOT NULL,
	"updated_at_tx" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocol_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"keeper_bps" integer DEFAULT 0 NOT NULL,
	"dev_bps" integer DEFAULT 0 NOT NULL,
	"lp_bps" integer DEFAULT 0 NOT NULL,
	"min_collateral" numeric DEFAULT '0' NOT NULL,
	"cooldown_duration" numeric DEFAULT '0' NOT NULL,
	"min_position_lifetime" numeric DEFAULT '0' NOT NULL,
	"max_utilization_ratio" numeric DEFAULT '0' NOT NULL,
	"funding_cut_bps" integer DEFAULT 0 NOT NULL,
	"adl_pnl_bps" integer DEFAULT 0 NOT NULL,
	"adl_utilization_bps" integer DEFAULT 0 NOT NULL,
	"base_borrow_rate_bps" numeric DEFAULT '0' NOT NULL,
	"slope1_bps" numeric DEFAULT '0' NOT NULL,
	"slope2_bps" numeric DEFAULT '0' NOT NULL,
	"optimal_utilization_bps" numeric DEFAULT '0' NOT NULL,
	"base_funding_rate_bps" numeric DEFAULT '0' NOT NULL,
	"updated_at_ledger" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "role_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tx_hash" text NOT NULL,
	"ledger" integer NOT NULL,
	"timestamp" numeric NOT NULL,
	"role" text NOT NULL,
	"account" text NOT NULL,
	"is_grant" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trades_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tx_hash" text NOT NULL,
	"ledger" integer NOT NULL,
	"timestamp" numeric NOT NULL,
	"trader" text NOT NULL,
	"symbol" text NOT NULL,
	"event_type" text NOT NULL,
	"size_delta" numeric NOT NULL,
	"collateral_delta" numeric DEFAULT '0' NOT NULL,
	"entry_price" numeric DEFAULT '0' NOT NULL,
	"mark_price" numeric DEFAULT '0' NOT NULL,
	"pnl" numeric DEFAULT '0' NOT NULL,
	"borrow_fee" numeric DEFAULT '0' NOT NULL,
	"funding_fee" numeric DEFAULT '0' NOT NULL,
	"is_long" boolean,
	"is_full_close" boolean,
	"is_tp" boolean,
	"keeper" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vault_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tx_hash" text NOT NULL,
	"ledger" integer NOT NULL,
	"timestamp" numeric NOT NULL,
	"event_type" text NOT NULL,
	"user" text NOT NULL,
	"assets" numeric NOT NULL,
	"shares" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"total_assets" numeric DEFAULT '0' NOT NULL,
	"total_shares" numeric DEFAULT '0' NOT NULL,
	"reserved_usdc" numeric DEFAULT '0' NOT NULL,
	"unclaimed_fees" numeric DEFAULT '0' NOT NULL,
	"net_global_trader_pnl" numeric DEFAULT '0' NOT NULL,
	"free_liquidity" numeric DEFAULT '0' NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"updated_at_ledger" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "positions_trader_symbol_idx" ON "positions" USING btree ("trader","symbol");