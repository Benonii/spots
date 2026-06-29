-- The 0012 cover policies gated on is_admin(), but our SECURITY DEFINER role
-- helper doesn't evaluate reliably inside storage's RLS context, so admin
-- uploads were rejected ("new row violates row-level security policy").
--
-- Replace them with a tight, INSERT-only policy: a signed-in user may only ADD
-- new objects to the spot-covers bucket — never overwrite or delete an existing
-- one (so covers can't be defaced or removed). Uploads use unique paths, so this
-- still covers both creating and re-uploading a cover. The real authorization
-- gate stays on the admin-only spots INSERT policy (which can't be satisfied by a
-- non-admin), so a stray uploaded object can't be attached to a spot. There is
-- intentionally NO update/delete policy for the authenticated role; the CLI's
-- service-role connection still manages/garbage-collects covers, bypassing RLS.
DROP POLICY IF EXISTS "admins write covers" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "admins replace covers" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "admins remove covers" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "covers insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'spot-covers');
