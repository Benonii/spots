-- Hide the "Map" button on a spot without losing its Maps link.
--
-- Some scraped spots carry a map_url that points at the wrong place. Clearing
-- the column would be the obvious fix, but those links are what we dedupe
-- against when deciding whether a newly-seen venue is one we already have — so
-- the link has to stay and only the button goes.
--
-- Journal `when` must be greater than every entry already applied. drizzle
-- compares only against the newest applied timestamp — not `idx`, not a set of
-- hashes — so a stale one makes `db:migrate` exit 0 having done nothing. This
-- entry was first dated 1787100000000, below 0024's real 1787301007578, and was
-- silently skipped; it is now 1787400000000. The same rule binds at merge time:
-- this migration must reach main before any migration dated after it.
--
-- Deliberately not a locked_field: it's a curation flag about our own data
-- quality, not one of the scrape-owned columns an upsert could revert.

ALTER TABLE "spots" ADD COLUMN "hide_map" boolean DEFAULT false NOT NULL;
