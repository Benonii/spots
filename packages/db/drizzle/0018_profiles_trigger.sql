-- Make the profiles row an invariant, not a hope. Until now the ONLY creation
-- path was the client's best-effort upsertProfile() on sign-in (errors
-- swallowed) — verified in prod: 2 of 4 dating opt-ins had no profiles row, so
-- they surfaced as a nameless "Someone" in match results. Standard Supabase
-- pattern: an AFTER INSERT trigger on auth.users creates the row server-side,
-- projecting name/avatar from raw_user_meta_data the same way search_profiles()
-- does. The client upsert stays, demoted to refreshing name/avatar on later
-- sign-ins. Plus a one-time backfill for existing accounts missing rows.

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    new.id::text,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    COALESCE(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint
-- Backfill: every existing account without a profiles row (fixes the two
-- opted-in accounts currently showing as "Someone" in match results).
INSERT INTO public.profiles (id, display_name, avatar_url)
SELECT u.id::text,
       COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
       COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id::text
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
