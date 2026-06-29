CREATE TABLE "package_versions" (
	"package_name" text NOT NULL,
	"version" text NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "package_versions_package_name_version_pk" PRIMARY KEY("package_name","version")
);
--> statement-breakpoint
CREATE TABLE "watch_state" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" text NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "package_versions_name_published_idx" ON "package_versions" USING btree ("package_name","published_at");