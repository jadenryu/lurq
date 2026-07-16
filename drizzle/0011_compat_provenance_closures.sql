CREATE TABLE "resolved_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_name" text NOT NULL,
	"version" text NOT NULL,
	"nodes" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compat_edges" ADD COLUMN "provenance" text DEFAULT 'verified' NOT NULL;--> statement-breakpoint
ALTER TABLE "compat_edges" ADD COLUMN "witness_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resolved_closures_pkg_idx" ON "resolved_closures" USING btree ("package_name","version");