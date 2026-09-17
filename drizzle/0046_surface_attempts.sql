ALTER TABLE "packages" ADD COLUMN "surface_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "surface_attempted_version" text;