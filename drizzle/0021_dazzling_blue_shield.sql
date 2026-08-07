CREATE TABLE "repos" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text,
	"is_private" boolean DEFAULT false NOT NULL,
	"policy" jsonb NOT NULL,
	"manifests" jsonb,
	"drift" jsonb,
	"last_scan_at" timestamp with time zone,
	"last_scan_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "repos_owner_full_name_idx" ON "repos" USING btree ("owner_id","full_name");--> statement-breakpoint
CREATE INDEX "repos_installation_idx" ON "repos" USING btree ("installation_id");