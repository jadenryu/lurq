CREATE TABLE "surface_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_name" text NOT NULL,
	"version" text,
	"spec_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "surface_queue_spec_key_unique" UNIQUE("spec_key")
);
--> statement-breakpoint
CREATE INDEX "surface_queue_requested_idx" ON "surface_queue" USING btree ("requested_at");