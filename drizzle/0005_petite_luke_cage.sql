CREATE TABLE "compat_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_a" text NOT NULL,
	"version_a" text NOT NULL,
	"package_b" text NOT NULL,
	"version_b" text NOT NULL,
	"status" text NOT NULL,
	"driver" text NOT NULL,
	"ran_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "compat_edges_pair_idx" ON "compat_edges" USING btree ("package_a","version_a","package_b","version_b");