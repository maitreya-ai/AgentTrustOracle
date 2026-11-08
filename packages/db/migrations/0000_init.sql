CREATE TYPE "public"."epoch_status" AS ENUM('computed', 'publishing', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."link_kind" AS ENUM('registry_owner', 'registry_agent_wallet', 'registry_creator', 'registry_parent', 'funded_by', 'fee_payer', 'channel_rent_payer', 'close_destination');--> statement-breakpoint
CREATE TYPE "public"."payment_rail" AS ENUM('x402_exact', 'payment_channel', 'direct_transfer');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('pending', 'resolved', 'unresolvable');--> statement-breakpoint
CREATE TYPE "public"."registry_kind" AS ENUM('8004', 'sati', 'wallet');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"registry" "registry_kind" NOT NULL,
	"wallets" text[] NOT NULL,
	"owner" text,
	"creator" text,
	"parent" text,
	"agent_uri" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epochs" (
	"epoch" bigint PRIMARY KEY NOT NULL,
	"status" "epoch_status" DEFAULT 'computed' NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"methodology_version" integer NOT NULL,
	"methodology_hash" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"merkle_root" text NOT NULL,
	"agent_count" integer NOT NULL,
	"stats" jsonb NOT NULL,
	"diagnostics" jsonb NOT NULL,
	"publish_signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingest_cursors" (
	"stream" text PRIMARY KEY NOT NULL,
	"last_signature" text,
	"last_slot" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"rail" "payment_rail" NOT NULL,
	"payer" text NOT NULL,
	"payee" text NOT NULL,
	"mint" text NOT NULL,
	"amount" numeric(20, 0) NOT NULL,
	"usd_micros" bigint NOT NULL,
	"fee_payer" text,
	"facilitator" text,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"epoch" bigint NOT NULL,
	"agent_id" text NOT NULL,
	"registry" "registry_kind" NOT NULL,
	"entity" text NOT NULL,
	"score" integer NOT NULL,
	"confidence" integer NOT NULL,
	"flags" integer NOT NULL,
	"wash_ratio_bps" integer NOT NULL,
	"unique_payers" integer NOT NULL,
	"organic_volume_micros" bigint NOT NULL,
	"raw_volume_micros" bigint NOT NULL,
	"components" jsonb NOT NULL,
	"features" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"proof" text[] NOT NULL,
	"publish_signature" text,
	CONSTRAINT "scores_epoch_agent_id_pk" PRIMARY KEY("epoch","agent_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_links" (
	"from" text NOT NULL,
	"to" text NOT NULL,
	"kind" "link_kind" NOT NULL,
	"evidence" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_links_from_to_kind_pk" PRIMARY KEY("from","to","kind")
);
--> statement-breakpoint
CREATE TABLE "wallet_profiles" (
	"address" text PRIMARY KEY NOT NULL,
	"status" "profile_status" DEFAULT 'pending' NOT NULL,
	"first_seen_at" timestamp with time zone,
	"first_funder" text,
	"funding_signature" text,
	"note" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "payments_block_time_idx" ON "payments" USING btree ("block_time");--> statement-breakpoint
CREATE INDEX "payments_payee_time_idx" ON "payments" USING btree ("payee","block_time");--> statement-breakpoint
CREATE INDEX "payments_payer_time_idx" ON "payments" USING btree ("payer","block_time");--> statement-breakpoint
CREATE INDEX "scores_agent_idx" ON "scores" USING btree ("agent_id","epoch");--> statement-breakpoint
CREATE INDEX "wallet_links_to_idx" ON "wallet_links" USING btree ("to");--> statement-breakpoint
CREATE INDEX "wallet_profiles_status_idx" ON "wallet_profiles" USING btree ("status");