ALTER TABLE "package_versions" ADD COLUMN "peer_dependencies" jsonb;--> statement-breakpoint
ALTER TABLE "package_versions" ADD COLUMN "engines" jsonb;