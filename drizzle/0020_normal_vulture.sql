DROP INDEX "symbols_entity_path_idx";--> statement-breakpoint
ALTER TABLE "symbols" ADD COLUMN "signature" text;--> statement-breakpoint
CREATE UNIQUE INDEX "symbols_entity_path_tier_idx" ON "symbols" USING btree ("entity_id","path","tier");