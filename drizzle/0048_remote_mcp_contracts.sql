CREATE TABLE "mcp_endpoint_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint_id" integer NOT NULL,
	"kind" text NOT NULL,
	"from_key" text NOT NULL,
	"to_key" text NOT NULL,
	"severity" text NOT NULL,
	"summary" text NOT NULL,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_endpoint_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint_id" integer NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"content_hash" text,
	"auth_hash" text,
	"violations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"protocol_version" text,
	"error" text,
	"probe_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_endpoint_servers" (
	"endpoint_id" integer NOT NULL,
	"server_name" text NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "mcp_endpoint_servers_endpoint_id_server_name_pk" PRIMARY KEY("endpoint_id","server_name")
);
--> statement-breakpoint
CREATE TABLE "mcp_registry_servers" (
	"name" text NOT NULL,
	"version" text NOT NULL,
	"title" text,
	"description" text,
	"website_url" text,
	"repository_url" text,
	"status" text NOT NULL,
	"is_latest" boolean NOT NULL,
	"remotes" jsonb NOT NULL,
	"packages" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"registry_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_registry_servers_name_version_pk" PRIMARY KEY("name","version")
);
--> statement-breakpoint
CREATE TABLE "mcp_remote_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"host" text NOT NULL,
	"transport" text NOT NULL,
	"templated" boolean DEFAULT false NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"last_status" text,
	"last_http_status" integer,
	"last_content_hash" text,
	"last_auth_hash" text,
	"auth" jsonb,
	"violations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"protocol_mode" text,
	"protocol_version" text,
	"server_name" text,
	"server_version" text,
	"final_url" text,
	"latency_ms" integer,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"probe_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_probed_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"next_probe_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"removed_at" timestamp with time zone,
	CONSTRAINT "mcp_remote_endpoints_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "mcp_endpoint_changes" ADD CONSTRAINT "mcp_endpoint_changes_endpoint_id_mcp_remote_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."mcp_remote_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_endpoint_observations" ADD CONSTRAINT "mcp_endpoint_observations_endpoint_id_mcp_remote_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."mcp_remote_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_endpoint_servers" ADD CONSTRAINT "mcp_endpoint_servers_endpoint_id_mcp_remote_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."mcp_remote_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_endpoint_changes_pair_idx" ON "mcp_endpoint_changes" USING btree ("endpoint_id","kind","from_key","to_key");--> statement-breakpoint
CREATE INDEX "mcp_endpoint_changes_endpoint_idx" ON "mcp_endpoint_changes" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_endpoint_changes_created_idx" ON "mcp_endpoint_changes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mcp_endpoint_observations_endpoint_idx" ON "mcp_endpoint_observations" USING btree ("endpoint_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "mcp_endpoint_servers_name_idx" ON "mcp_endpoint_servers" USING btree ("server_name");--> statement-breakpoint
CREATE INDEX "mcp_registry_servers_latest_idx" ON "mcp_registry_servers" USING btree ("name") WHERE "mcp_registry_servers"."is_latest";--> statement-breakpoint
CREATE INDEX "mcp_registry_servers_updated_idx" ON "mcp_registry_servers" USING btree ("registry_updated_at");--> statement-breakpoint
CREATE INDEX "mcp_remote_endpoints_due_idx" ON "mcp_remote_endpoints" USING btree ("next_probe_at") WHERE "mcp_remote_endpoints"."opted_out" = false and "mcp_remote_endpoints"."templated" = false and "mcp_remote_endpoints"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "mcp_remote_endpoints_host_idx" ON "mcp_remote_endpoints" USING btree ("host");