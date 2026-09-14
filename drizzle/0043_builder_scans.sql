CREATE TABLE "builder_scans" (
	"owner_id" text NOT NULL,
	"target" text NOT NULL,
	"login" text NOT NULL,
	"archetype" text NOT NULL,
	"avatar_url" text NOT NULL,
	"profile" jsonb NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builder_scans_owner_id_target_pk" PRIMARY KEY("owner_id","target")
);
--> statement-breakpoint
CREATE INDEX "builder_scans_owner_recent_idx" ON "builder_scans" USING btree ("owner_id","scanned_at");