CREATE TABLE "repo_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"repo_id" integer NOT NULL,
	"repo_full_name" text NOT NULL,
	"package_name" text NOT NULL,
	"range" text NOT NULL,
	"from_version" text,
	"to_version" text NOT NULL,
	"in_range" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "repo_alerts_owner_created_idx" ON "repo_alerts" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_alerts_dedup_idx" ON "repo_alerts" USING btree ("repo_id","package_name","to_version");