CREATE TABLE "selection_policies" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"policy" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
