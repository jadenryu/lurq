CREATE TABLE "packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ecosystem" text DEFAULT 'npm' NOT NULL,
	"category" text,
	"description" text,
	"summary" text,
	"repo_url" text,
	"homepage" text,
	"latest_version" text,
	"license" text,
	"deprecated" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"first_published_at" timestamp with time zone,
	"last_release_at" timestamp with time zone,
	"weekly_downloads" bigint,
	"download_growth_90d" real,
	"dependents_count" integer,
	"stars" integer,
	"open_issues" integer,
	"closed_issues" integer,
	"scorecard" real,
	"bundle_min_gzip_kb" real,
	"advisories" jsonb,
	"health_score" integer,
	"confidence" text,
	"score_breakdown" jsonb,
	"usage_guide" jsonb,
	"embedding" vector(1536),
	"data_as_of" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packages_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "seed_packages" (
	"name" text PRIMARY KEY NOT NULL,
	"category" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"packages_seen" integer DEFAULT 0 NOT NULL,
	"packages_updated" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "packages_category_idx" ON "packages" USING btree ("category");--> statement-breakpoint
CREATE INDEX "packages_health_score_idx" ON "packages" USING btree ("health_score");--> statement-breakpoint
CREATE INDEX "packages_embedding_idx" ON "packages" USING hnsw ("embedding" vector_cosine_ops);