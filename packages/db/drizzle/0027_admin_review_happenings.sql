-- Admins review events in the app: edit the extraction, then publish or reject.
--
-- 0022 said "no insert/update policy exists on purpose — the review queue is a
-- CLI command." That held while volume was a handful of rows and one person
-- had a laptop open. It didn't hold in practice: nothing ever wrote
-- reviewed_at, and pending events expired in a queue nobody could open. The
-- review now lives where the other curation does — the admin menu — so this
-- reverses 0022 deliberately.
--
-- UPDATE only. Inserts stay with the poller and deletes with the CLI. The
-- existing CHECK happenings_published_needs_start still refuses to publish an
-- undated row whatever the app sends.

CREATE POLICY "admins review happenings" ON "happenings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_admin()) WITH CHECK (is_admin());
