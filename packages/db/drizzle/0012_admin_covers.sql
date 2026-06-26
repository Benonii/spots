-- Hand-written (Drizzle doesn't manage the storage schema): let admins upload
-- spot cover images from the browser. Reuses is_admin() from 0011.

-- Ensure the public covers bucket exists. The CLI also creates it on first
-- upsert; doing it here makes web cover uploads work before the pipeline runs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('spot-covers', 'spot-covers', true)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Admins may add / replace / remove objects in the spot-covers bucket. Reads
-- stay public (the bucket is public); the CLI keeps using the service role,
-- which bypasses RLS entirely.
CREATE POLICY "admins write covers" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'spot-covers' AND is_admin());
--> statement-breakpoint
CREATE POLICY "admins replace covers" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'spot-covers' AND is_admin())
  WITH CHECK (bucket_id = 'spot-covers' AND is_admin());
--> statement-breakpoint
CREATE POLICY "admins remove covers" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'spot-covers' AND is_admin());
