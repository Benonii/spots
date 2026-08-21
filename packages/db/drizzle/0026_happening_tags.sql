-- Categories for events, so the app can filter them the way it filters spots.
--
-- A fixed vocabulary, not free text: filter chips have to be a closed set or
-- they multiply with every novel word the model invents. The list is enforced
-- in the Zod extraction schema (apps/cli/src/happenings-extraction.ts), which is
-- where a bad value would actually be produced.
--
-- Keyword-matching over titles was tried first and missed 7 of 32 events —
-- "Afropia Dance Battle" and "Ethiopian CyberShield 2026" carry no category
-- word at all. The model reads what the post is about instead.

ALTER TABLE "happenings" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "happenings_tags_idx" ON "happenings" USING gin ("tags");
