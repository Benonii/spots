-- Find people to promote by display name OR email, even if they have no profiles
-- row yet. Most accounts exist in auth.users (created on sign-in) but the app-side
-- profile upsert is best-effort, so a profiles row isn't guaranteed. We therefore
-- source from auth.users and LEFT JOIN profiles. Email lives in auth.users (which
-- the `authenticated` role can't read), so this is SECURITY DEFINER, gated on
-- is_admin() internally — a non-admin caller gets zero rows.
CREATE OR REPLACE FUNCTION search_profiles(query text)
  RETURNS TABLE (id text, display_name text, avatar_url text, role text, email text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    u.id::text,
    COALESCE(p.display_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
    COALESCE(p.avatar_url, u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture'),
    COALESCE(p.role, 'user'),
    u.email::text
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id::text
  WHERE public.is_admin()
    AND (
      COALESCE(p.display_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') ILIKE '%' || query || '%'
      OR u.email ILIKE '%' || query || '%'
    )
  ORDER BY COALESCE(p.role, 'user') DESC, u.email
  LIMIT 8;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION search_profiles(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION search_profiles(text) TO authenticated;--> statement-breakpoint

-- Promotion must work even when the target has no profiles row yet: upsert it.
-- Still super-gated and the sole writer of the locked `role` column.
CREATE OR REPLACE FUNCTION set_role(target_id text, new_role text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin can change roles';
  END IF;
  IF new_role NOT IN ('user','admin','super') THEN
    RAISE EXCEPTION 'invalid role: %', new_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id::text = target_id) THEN
    RAISE EXCEPTION 'no account for %', target_id;
  END IF;
  INSERT INTO public.profiles (id, display_name, avatar_url, role, updated_at)
  SELECT u.id::text,
         u.raw_user_meta_data->>'full_name',
         u.raw_user_meta_data->>'avatar_url',
         new_role,
         now()
  FROM auth.users u WHERE u.id::text = target_id
  ON CONFLICT (id) DO UPDATE SET role = excluded.role, updated_at = now();
END;
$$;
