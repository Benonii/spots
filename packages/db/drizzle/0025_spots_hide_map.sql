-- Hide the "Map" button on a spot without losing its Maps link.
--
-- Some scraped spots carry a map_url that points at the wrong place. Clearing
-- the column would be the obvious fix, but those links are what we dedupe
-- against when deciding whether a newly-seen venue is one we already have — so
-- the link has to stay and only the button goes.
--
-- Deliberately not a locked_field: it's a curation flag about our own data
-- quality, not one of the scrape-owned columns an upsert could revert.

ALTER TABLE "spots" ADD COLUMN "hide_map" boolean DEFAULT false NOT NULL;
