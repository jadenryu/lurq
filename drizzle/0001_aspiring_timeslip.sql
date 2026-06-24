CREATE TABLE "discovery_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"discovered_via" text NOT NULL,
	"pre_score" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_queue_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "category_source" text;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "quality_score" integer;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(category, '')), 'B') || setweight(to_tsvector('english', coalesce(summary, description, '')), 'C')) STORED;--> statement-breakpoint
CREATE INDEX "discovery_queue_status_idx" ON "discovery_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "packages_search_vector_idx" ON "packages" USING gin ("search_vector");