CREATE TABLE "api_surfaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_name" text NOT NULL,
	"version" text NOT NULL,
	"surface" jsonb NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_surfaces_pkg_idx" ON "api_surfaces" USING btree ("package_name","version");