CREATE TABLE "stack_resolutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_key" text NOT NULL,
	"packages" jsonb NOT NULL,
	"names" text[] NOT NULL,
	"resolved" boolean NOT NULL,
	"reason" text,
	"detail" text,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stack_resolutions_set_key_unique" UNIQUE("set_key")
);
--> statement-breakpoint
CREATE INDEX "stack_resolutions_names_idx" ON "stack_resolutions" USING gin ("names");--> statement-breakpoint
CREATE INDEX "stack_resolutions_resolved_at_idx" ON "stack_resolutions" USING btree ("resolved_at");