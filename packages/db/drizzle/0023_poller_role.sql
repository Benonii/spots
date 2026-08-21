-- A least-privilege login for the scheduled happenings poller.
--
-- The CLI's normal DATABASE_URL bypasses RLS on every table in the project.
-- That's fine on a laptop; it is not fine sitting in a GitHub Actions secret on
-- a public repo. This role can reach exactly one table.
--
-- Created WITHOUT a password on purpose — a committed credential is not a
-- credential. Set one out of band before using it:
--     ALTER ROLE spots_poller WITH PASSWORD '<generated>';
-- Until then the role exists but cannot authenticate.
--
-- RLS is enforced for this role (unlike the CLI's superuser-ish connection), so
-- the GRANTs alone are not enough — hence the policy. Both together are the
-- limit: no other table is reachable even if the credential leaks.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spots_poller') THEN
    CREATE ROLE spots_poller LOGIN NOINHERIT;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO spots_poller;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.happenings TO spots_poller;--> statement-breakpoint
CREATE POLICY "poller manages happenings" ON "happenings" AS PERMISSIVE FOR ALL TO "spots_poller" USING (true) WITH CHECK (true);
