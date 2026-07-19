CREATE TABLE "compat_verify_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_key" text NOT NULL,
	"packages" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compat_verify_queue_set_key_unique" UNIQUE("set_key")
);
--> statement-breakpoint
CREATE INDEX "compat_verify_queue_requested_idx" ON "compat_verify_queue" USING btree ("requested_at");