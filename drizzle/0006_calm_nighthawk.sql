ALTER TABLE "packages" ADD COLUMN "peer_dependencies" jsonb;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "peer_dependencies_meta" jsonb;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "engines" jsonb;