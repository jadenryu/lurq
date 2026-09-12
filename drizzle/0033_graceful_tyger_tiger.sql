DROP INDEX "surface_queue_requested_idx";--> statement-breakpoint
ALTER TABLE "surface_queue" ADD COLUMN "kind" text DEFAULT 'package_surface' NOT NULL;--> statement-breakpoint
CREATE INDEX "surface_queue_requested_idx" ON "surface_queue" USING btree ("kind","requested_at");