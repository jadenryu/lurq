ALTER TABLE "packages" DROP CONSTRAINT "packages_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "packages_ecosystem_name_idx" ON "packages" USING btree ("ecosystem","name");