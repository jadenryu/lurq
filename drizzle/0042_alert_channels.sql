CREATE TABLE "notification_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"url_ciphertext" text NOT NULL,
	"url_hint" text NOT NULL,
	"signing_secret_ciphertext" text,
	"min_severity" text DEFAULT 'high' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"disabled_reason" text,
	"last_delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "channel_id" integer;--> statement-breakpoint
CREATE INDEX "notification_channels_owner_idx" ON "notification_channels" USING btree ("owner_id");