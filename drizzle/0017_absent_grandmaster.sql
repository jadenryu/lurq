CREATE TABLE "symbols" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"arity" integer,
	"origin" text DEFAULT 'local' NOT NULL,
	"deprecated" boolean DEFAULT false NOT NULL,
	"tier" text NOT NULL,
	"source_file" text,
	"source_line" integer
);
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "artifact_hash" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "in_degree" integer;--> statement-breakpoint
ALTER TABLE "observations" ADD COLUMN "class" text DEFAULT 'executed' NOT NULL;--> statement-breakpoint
ALTER TABLE "observations" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "symbols_entity_path_idx" ON "symbols" USING btree ("entity_id","path");--> statement-breakpoint
CREATE INDEX "entities_artifact_idx" ON "entities" USING btree ("artifact_hash");