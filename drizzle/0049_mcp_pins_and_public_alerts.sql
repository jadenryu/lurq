CREATE TABLE "mcp_endpoint_change_acks" (
	"owner_id" text NOT NULL,
	"change_id" integer NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_endpoint_change_acks_owner_id_change_id_pk" PRIMARY KEY("owner_id","change_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_pins" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"endpoint_id" integer NOT NULL,
	"content_hash" text,
	"auth_hash" text,
	"note" text,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mcp_remote_endpoints" ADD COLUMN "scan_key" text;--> statement-breakpoint
ALTER TABLE "mcp_endpoint_change_acks" ADD CONSTRAINT "mcp_endpoint_change_acks_change_id_mcp_endpoint_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."mcp_endpoint_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_pins" ADD CONSTRAINT "mcp_pins_endpoint_id_mcp_remote_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."mcp_remote_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_pins_owner_endpoint_idx" ON "mcp_pins" USING btree ("owner_id","endpoint_id");--> statement-breakpoint
CREATE INDEX "mcp_pins_endpoint_idx" ON "mcp_pins" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "mcp_remote_endpoints_scan_key_idx" ON "mcp_remote_endpoints" USING btree ("scan_key");