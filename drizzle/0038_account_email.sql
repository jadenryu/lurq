CREATE TABLE "notification_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_deliveries_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "notification_items" (
	"item_key" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"delivery_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"urgent_email" boolean DEFAULT true NOT NULL,
	"weekly_digest" boolean DEFAULT false NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"last_digest_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_unsubscribe_token_unique" UNIQUE("unsubscribe_token")
);
--> statement-breakpoint
ALTER TABLE "notification_items" ADD CONSTRAINT "notification_items_delivery_id_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_owner_idx" ON "notification_deliveries" USING btree ("owner_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notification_items_delivery_idx" ON "notification_items" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "mcp_change_events_created_idx" ON "mcp_change_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "repo_alerts_created_idx" ON "repo_alerts" USING btree ("created_at");