CREATE TABLE "policy_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"package_name" text NOT NULL,
	"rule" text NOT NULL,
	"action" text NOT NULL,
	"tool" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selection_policy_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"actor" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "policy_decisions_owner_idx" ON "policy_decisions" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "selection_policy_changes_owner_idx" ON "selection_policy_changes" USING btree ("owner_id","created_at");