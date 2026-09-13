ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billing_interval" text;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN IF NOT EXISTS "source_offset" integer;--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN IF NOT EXISTS "max_arity" integer;