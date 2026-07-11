-- my_matches() now also returns the NAMES of the spots two people matched on
-- (for the "also wants to go to Texas Burger and Cake n Bake" line), not just a
-- count. Adding a column to the RETURNS TABLE changes the return type, which
-- CREATE OR REPLACE can't do — so drop and recreate, then restore the grants.
-- shared_spots is ordered best-first (quality) and skips hidden/tombstoned
-- spots; still SECURITY DEFINER, still gated on reciprocal likes + no block.

DROP FUNCTION IF EXISTS my_matches();
--> statement-breakpoint
CREATE FUNCTION my_matches()
  RETURNS TABLE (user_id text, display_name text, avatar_url text, contact_type text, contact_value text, overlap_count int, shared_spots text[], matched_at timestamp with time zone)
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
    (SELECT array_agg(sp.name ORDER BY sp.quality_score DESC, sp.name)
       FROM public.saved_spots s1
       JOIN public.saved_spots s2 ON s2.google_place_id = s1.google_place_id
       JOIN public.spots sp ON sp.google_place_id = s1.google_place_id
      WHERE s1.user_id = lout.from_user AND s2.user_id = lout.to_user
        AND NOT sp.hidden) AS shared_spots,
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION my_matches() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION my_matches() TO authenticated;
