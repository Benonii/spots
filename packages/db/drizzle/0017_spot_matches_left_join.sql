-- Fix: matches_for_spot() / my_matches() inner-joined profiles, so an opted-in
-- user whose best-effort profile row hadn't landed yet was dropped from results
-- (undercounts that drift upward as profile upserts trickle in). Match visibility
-- must not depend on a profiles row — LEFT JOIN instead; name/avatar fall back to
-- null and the client renders "Someone" until the profile appears. Bodies are
-- otherwise unchanged; CREATE OR REPLACE preserves the existing REVOKE/GRANT.

CREATE OR REPLACE FUNCTION matches_for_spot(place_id text)
  RETURNS TABLE (user_id text, display_name text, avatar_url text, overlap_count int, liked boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    o.user_id,
    p.display_name,
    p.avatar_url,
    (SELECT count(*)::int
       FROM public.saved_spots s1
       JOIN public.saved_spots s2 ON s2.google_place_id = s1.google_place_id
      WHERE s1.user_id = (SELECT auth.uid())::text
        AND s2.user_id = o.user_id) AS overlap_count,
    EXISTS (SELECT 1 FROM public.likes l
             WHERE l.from_user = (SELECT auth.uid())::text
               AND l.to_user = o.user_id) AS liked
  FROM public.dating_opt_in o
  JOIN public.saved_spots sv ON sv.user_id = o.user_id AND sv.google_place_id = place_id
  LEFT JOIN public.profiles p ON p.id = o.user_id
  WHERE o.active
    AND o.user_id <> (SELECT auth.uid())::text
    AND EXISTS (SELECT 1 FROM public.dating_opt_in mo
                 WHERE mo.user_id = (SELECT auth.uid())::text AND mo.active)
    AND NOT EXISTS (SELECT 1 FROM public.blocks b
                     WHERE (b.blocker = (SELECT auth.uid())::text AND b.blocked = o.user_id)
                        OR (b.blocker = o.user_id AND b.blocked = (SELECT auth.uid())::text))
  ORDER BY overlap_count DESC, p.display_name;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION my_matches()
  RETURNS TABLE (user_id text, display_name text, avatar_url text, contact_type text, contact_value text, overlap_count int, matched_at timestamp with time zone)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    lout.to_user AS user_id,
    p.display_name,
    p.avatar_url,
    o.contact_type,
    o.contact_value,
    (SELECT count(*)::int
       FROM public.saved_spots s1
       JOIN public.saved_spots s2 ON s2.google_place_id = s1.google_place_id
      WHERE s1.user_id = lout.from_user AND s2.user_id = lout.to_user) AS overlap_count,
    GREATEST(lout.created_at, lin.created_at) AS matched_at
  FROM public.likes lout
  JOIN public.likes lin ON lin.from_user = lout.to_user AND lin.to_user = lout.from_user
  JOIN public.dating_opt_in o ON o.user_id = lout.to_user AND o.active
  LEFT JOIN public.profiles p ON p.id = lout.to_user
  WHERE lout.from_user = (SELECT auth.uid())::text
    AND EXISTS (SELECT 1 FROM public.dating_opt_in mo
                 WHERE mo.user_id = (SELECT auth.uid())::text AND mo.active)
    AND NOT EXISTS (SELECT 1 FROM public.blocks b
                     WHERE (b.blocker = (SELECT auth.uid())::text AND b.blocked = lout.to_user)
                        OR (b.blocker = lout.to_user AND b.blocked = (SELECT auth.uid())::text))
  ORDER BY matched_at DESC;
$$;
