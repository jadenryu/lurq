ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "direct_dependents" integer;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "indirect_dependents" integer;
