CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_owner_id_unique" UNIQUE("owner_id")
);
