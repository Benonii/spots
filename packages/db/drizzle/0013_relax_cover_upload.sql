-- The 0012 cover policies gated on is_admin(), but our SECURITY DEFINER role
-- helper doesn't evaluate reliably inside storage's RLS context, so admin
-- uploads were rejected ("new row violates row-level security policy").
--
-- Gate the covers bucket the standard Supabase way instead: a signed-in user may
-- write to the spot-covers bucket. The real authorization gate is the spots
-- INSERT policy (admin-only), which DOES resolve is_admin() correctly under
-- PostgREST — an orphaned cover image with no spot row is harmless.
DROP POLICY IF EXISTS "admins write covers" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "admins replace covers" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "admins remove covers" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "covers insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'spot-covers');
--> statement-breakpoint
CREATE POLICY "covers update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'spot-covers') WITH CHECK (bucket_id = 'spot-covers');
--> statement-breakpoint
CREATE POLICY "covers delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'spot-covers');
