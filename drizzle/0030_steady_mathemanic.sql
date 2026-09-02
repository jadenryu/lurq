CREATE TABLE "ask_spend_daily" (
	"owner_id" text NOT NULL,
	"date" date NOT NULL,
	"usd_micros" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ask_spend_daily_owner_id_date_pk" PRIMARY KEY("owner_id","date")
);
