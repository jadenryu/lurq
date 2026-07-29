CREATE TABLE "owner_usage_daily" (
	"owner_id" text NOT NULL,
	"date" date NOT NULL,
	"tool" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "owner_usage_daily_owner_id_date_tool_pk" PRIMARY KEY("owner_id","date","tool")
);
--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "first_requested_by_owner_id" text;--> statement-breakpoint
CREATE INDEX "owner_usage_daily_owner_date_idx" ON "owner_usage_daily" USING btree ("owner_id","date");--> statement-breakpoint
CREATE INDEX "packages_first_requested_by_idx" ON "packages" USING btree ("first_requested_by_owner_id");