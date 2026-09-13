CREATE TABLE "mcp_change_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"from_hash" text NOT NULL,
	"to_hash" text NOT NULL,
	"severity" text NOT NULL,
	"summary" text NOT NULL,
	"diff" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_contracts" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"contract_hash" text NOT NULL,
	"tools" jsonb NOT NULL,
	"prompts" jsonb NOT NULL,
	"resource_templates" jsonb NOT NULL,
	"instructions" text,
	"tool_count" integer NOT NULL,
	"bytes" integer NOT NULL,
	"analysis" jsonb NOT NULL,
	"analyzer_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"server_key" text NOT NULL,
	"config_fingerprint" text NOT NULL,
	"alias" text NOT NULL,
	"registry" text NOT NULL,
	"package_name" text,
	"transport" text NOT NULL,
	"server_name" text,
	"server_version" text,
	"last_status" text NOT NULL,
	"last_error" text,
	"last_content_hash" text,
	"worst_severity" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" integer NOT NULL,
	"owner_id" text NOT NULL,
	"status" text NOT NULL,
	"content_hash" text,
	"server_version" text,
	"error" text,
	"source" text NOT NULL,
	"scan_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_public_reports" (
	"registry" text NOT NULL,
	"package_name" text NOT NULL,
	"version" text NOT NULL,
	"content_hash" text NOT NULL,
	"owner_id" text NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_public_reports_registry_package_name_version_content_hash_owner_id_pk" PRIMARY KEY("registry","package_name","version","content_hash","owner_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_change_events" ADD CONSTRAINT "mcp_change_events_deployment_id_mcp_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."mcp_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_observations" ADD CONSTRAINT "mcp_observations_deployment_id_mcp_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."mcp_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_change_events_pair_idx" ON "mcp_change_events" USING btree ("deployment_id","from_hash","to_hash");--> statement-breakpoint
CREATE INDEX "mcp_change_events_owner_idx" ON "mcp_change_events" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_contracts_contract_idx" ON "mcp_contracts" USING btree ("contract_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_deployments_identity_idx" ON "mcp_deployments" USING btree ("owner_id","server_key","config_fingerprint");--> statement-breakpoint
CREATE INDEX "mcp_deployments_owner_idx" ON "mcp_deployments" USING btree ("owner_id","last_scanned_at");--> statement-breakpoint
CREATE INDEX "mcp_observations_deployment_idx" ON "mcp_observations" USING btree ("deployment_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "mcp_public_reports_version_idx" ON "mcp_public_reports" USING btree ("registry","package_name","version");