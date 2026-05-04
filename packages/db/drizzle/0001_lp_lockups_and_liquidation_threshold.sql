CREATE TABLE "vault_lockups" (
	"user" text PRIMARY KEY NOT NULL,
	"expires_at" numeric NOT NULL,
	"updated_at_ledger" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "protocol_config" ADD COLUMN "liquidation_threshold_bps" integer DEFAULT 0 NOT NULL;