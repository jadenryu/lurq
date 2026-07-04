CREATE TABLE "recommendation_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_name" text NOT NULL,
	"accepted" boolean NOT NULL,
	"build_signal" text,
	"need" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "recommendation_outcomes_pkg_idx" ON "recommendation_outcomes" USING btree ("package_name");