ALTER TABLE "profiles" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "source" text DEFAULT 'scrape' NOT NULL;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "map_url" text;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "locked_fields" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "spots" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_role_check" CHECK ("profiles"."role" in ('user','admin','super'));--> statement-breakpoint
-- ── curation roles (hand-added; Drizzle doesn't manage functions/grants) ──────
-- Role helpers read profiles.role with definer rights so RLS on profiles never
-- causes recursion or lockout. STABLE so the planner can cache them per-statement.
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())::text AND role IN ('admin','super')
  );
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())::text AND role = 'super'
  );
$$;--> statement-breakpoint
-- The only sanctioned way to change a role from the app: super-gated, definer so
-- it can write the locked column. Bootstrapping the first super bypasses this via
-- the CLI's direct (RLS/grant-bypassing) connection.
CREATE OR REPLACE FUNCTION set_role(target_id text, new_role text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin can change roles';
  END IF;
  IF new_role NOT IN ('user','admin','super') THEN
    RAISE EXCEPTION 'invalid role: %', new_role;
  END IF;
  UPDATE public.profiles SET role = new_role, updated_at = now() WHERE id = target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no profile for %', target_id;
  END IF;
END;
$$;--> statement-breakpoint
-- Column-level write-lock on profiles.role. RLS gates rows, not columns, so a
-- plain "update own profile" policy would let a user set their own role. Revoke
-- table-level write and re-grant every column EXCEPT role; set_role() (definer)
-- is then the sole writer. id is PK (never updated) so it's omitted from UPDATE.
REVOKE UPDATE ON public.profiles FROM authenticated;--> statement-breakpoint
GRANT UPDATE (display_name, avatar_url, updated_at) ON public.profiles TO authenticated;--> statement-breakpoint
REVOKE INSERT ON public.profiles FROM authenticated;--> statement-breakpoint
GRANT INSERT (id, display_name, avatar_url, updated_at) ON public.profiles TO authenticated;--> statement-breakpoint
CREATE POLICY "admins read all spots" ON "spots" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_admin());--> statement-breakpoint
CREATE POLICY "admins insert manual spots" ON "spots" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_admin() and "spots"."owner_id" = (select auth.uid())::text and "spots"."source" = 'manual');--> statement-breakpoint
CREATE POLICY "admins update own spots" ON "spots" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_super_admin() or (is_admin() and "spots"."owner_id" = (select auth.uid())::text)) WITH CHECK (is_super_admin() or (is_admin() and "spots"."owner_id" = (select auth.uid())::text));--> statement-breakpoint
CREATE POLICY "admins delete own manual spots" ON "spots" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("spots"."source" = 'manual' and (is_super_admin() or (is_admin() and "spots"."owner_id" = (select auth.uid())::text)));--> statement-breakpoint
ALTER POLICY "public read spots" ON "spots" TO anon,authenticated USING (not "spots"."hidden");