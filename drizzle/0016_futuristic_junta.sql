CREATE TABLE "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_id" integer NOT NULL,
	"object_id" integer,
	"relation" text NOT NULL,
	"environment_id" integer NOT NULL,
	"tenant_id" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"namespace" text NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"canonical_key" text NOT NULL,
	"tenant_id" bigint DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" serial PRIMARY KEY NOT NULL,
	"os" text NOT NULL,
	"arch" text NOT NULL,
	"runtime" text NOT NULL,
	"runtime_ver" text NOT NULL,
	"resolver" text,
	"fingerprint" text NOT NULL,
	CONSTRAINT "environments_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"verdict" text NOT NULL,
	"evidence" text,
	"oracle_id" text NOT NULL,
	"oracle_ver" text NOT NULL,
	"cost_millis" integer,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_subject_id_entities_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_object_id_entities_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_tuple_idx" ON "claims" USING btree ("subject_id","object_id","relation","environment_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_canonical_idx" ON "entities" USING btree ("canonical_key","tenant_id");--> statement-breakpoint
CREATE INDEX "entities_kind_idx" ON "entities" USING btree ("kind","namespace","name");--> statement-breakpoint
CREATE INDEX "observations_claim_idx" ON "observations" USING btree ("claim_id","observed_at");