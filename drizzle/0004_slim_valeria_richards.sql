CREATE TABLE "verification_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_name" text NOT NULL,
	"version" text NOT NULL,
	"driver" text NOT NULL,
	"module_system" text NOT NULL,
	"installed" boolean NOT NULL,
	"imported" boolean,
	"ran_scripts" boolean DEFAULT false NOT NULL,
	"duration_ms" integer,
	"error" text,
	"ran_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "verification_runs_pkg_idx" ON "verification_runs" USING btree ("package_name","version");