CREATE TABLE "upgrade_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"repo_id" integer,
	"repo_full_name" text NOT NULL,
	"package_name" text NOT NULL,
	"from_version" text NOT NULL,
	"to_version" text NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"symbols_affected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"call_sites" integer DEFAULT 0 NOT NULL,
	"call_site_files" jsonb,
	"files_changed" integer,
	"tests_passed" boolean,
	"pr_url" text,
	"run_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "install_command" text;--> statement-breakpoint
CREATE INDEX "upgrade_runs_owner_created_idx" ON "upgrade_runs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "upgrade_runs_repo_idx" ON "upgrade_runs" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upgrade_runs_dedup_idx" ON "upgrade_runs" USING btree ("owner_id","repo_full_name","package_name","to_version","run_url");