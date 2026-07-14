-- MAU was inflated: 57% of 30-day actors were one-hit anonymous ids and there
-- was no user_agent stored, so bots could never be separated from humans after
-- the fact. Store the client's UA (stamped client-side, best-effort) so future
-- windows can filter crawlers/preview-fetchers. Nullable — old rows stay null.
ALTER TABLE "events" ADD COLUMN "user_agent" text;
