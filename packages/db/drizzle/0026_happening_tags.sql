-- NOTE for the next hand-written migration: drizzle-kit applies only entries
-- whose journal `when` is later than the last one already applied. It does not
-- look at `idx`, does not mind gaps, and does not error on a stale timestamp —
-- it just silently does nothing. This file was first written with a round-number
-- `when` that predated 0024 and was skipped by a clean `db:migrate` run.
-- Always pick a `when` greater than every entry already in the journal.
--
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
