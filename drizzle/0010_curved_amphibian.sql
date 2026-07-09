ALTER TABLE "recommendation_outcomes" ADD COLUMN "owner_id" text;--> statement-breakpoint
CREATE INDEX "recommendation_outcomes_owner_idx" ON "recommendation_outcomes" USING btree ("owner_id");