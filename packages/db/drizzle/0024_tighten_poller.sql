-- Tighten spots_poller to what the poll command actually does: read the dedup
-- key, insert pending rows. 0023 granted UPDATE and an unconditional FOR ALL
-- policy anticipating the extraction stage; that was premature. With them, a
-- leaked POLLER_DATABASE_URL (a CI secret on a public repo — the exact scenario
-- 0023 defends against) could rewrite ticket_url on published rows or insert
-- rows born status = 'published', straight into the app.
--
-- Forward migration on purpose: 0023 is already applied to prod, so it must
-- not be edited.
--
-- When the extraction stage lands it will need UPDATE. Re-grant it then,
-- deliberately — ideally as a separate role with its own policy scoped to the
-- extraction columns — rather than widening this policy back to FOR ALL.

REVOKE UPDATE ON TABLE public.happenings FROM spots_poller;--> statement-breakpoint
DROP POLICY "poller manages happenings" ON "happenings";--> statement-breakpoint
CREATE POLICY "poller reads happenings" ON "happenings" AS PERMISSIVE FOR SELECT TO "spots_poller" USING (true);--> statement-breakpoint
CREATE POLICY "poller inserts pending happenings" ON "happenings" AS PERMISSIVE FOR INSERT TO "spots_poller" WITH CHECK ("happenings"."status" = 'pending');
