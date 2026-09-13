ALTER TABLE "subscriptions" ADD COLUMN "overage_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "overage_month" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "overage_reported" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_interval" text;