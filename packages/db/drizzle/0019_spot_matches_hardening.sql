-- Spot Matches hardening (adversarial-review findings).
--
-- 1) P1 — matches_for_spot() let any opted-in caller sweep all place ids and
--    reconstruct every opted-in user's full want-to-go list (it never required
--    the caller to have saved the spot). Gate on caller-saved: you only see who
--    wants to go somewhere YOU want to go — the actual product semantics. A
--    determined attacker could still save everything first, but that makes the
--    probe conspicuous and costly instead of free and silent.
-- 2) P2 — leaveDating() could only delete the opt-in row and OUTGOING likes
--    (RLS blocks deleting incoming ones), so stale incoming likes survived and
--    a later re-opt-in + single like-back would mint a match the user never saw
--    coming. leave_dating() (DEFINER) wipes the opt-in, likes in BOTH
--    directions, and the user's own blocks. Blocks AGAINST the user are kept —
--    that's other people's safety data.
-- 3) P2 — likes/blocks had no FKs (to_user could be junk or a departed user).
--    Now that 0018 guarantees a profiles row per account, FK them to
--    profiles(id) ON DELETE CASCADE; orphans are swept first so the ALTERs
--    can't fail.

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
    -- the caller must want to go here too — kills free enumeration of other
    -- people's lists across arbitrary spots
    AND EXISTS (SELECT 1 FROM public.saved_spots cs
                 WHERE cs.user_id = (SELECT auth.uid())::text
                   AND cs.google_place_id = place_id)
    AND NOT EXISTS (SELECT 1 FROM public.blocks b
                     WHERE (b.blocker = (SELECT auth.uid())::text AND b.blocked = o.user_id)
                        OR (b.blocker = o.user_id AND b.blocked = (SELECT auth.uid())::text))
  ORDER BY overlap_count DESC, p.display_name;
$$;
--> statement-breakpoint
-- Full exit: opt-in row, likes in both directions (incoming ones are deletable
-- only here — RLS scopes the client to outgoing), and the caller's own blocks.
CREATE OR REPLACE FUNCTION leave_dating() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid text := (SELECT auth.uid())::text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;
  DELETE FROM public.dating_opt_in WHERE user_id = uid;
  DELETE FROM public.likes WHERE from_user = uid OR to_user = uid;
  DELETE FROM public.blocks WHERE blocker = uid; -- keep blocks AGAINST the user
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION leave_dating() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION leave_dating() TO authenticated;
--> statement-breakpoint
-- Referential integrity (profiles rows are guaranteed since 0018). Sweep any
-- orphans first so the ALTERs can't fail on pre-existing junk.
DELETE FROM likes l WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = l.from_user)
                       OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = l.to_user);
--> statement-breakpoint
DELETE FROM blocks b WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = b.blocker)
                        OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = b.blocked);
--> statement-breakpoint
DELETE FROM dating_opt_in o WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = o.user_id);
--> statement-breakpoint
ALTER TABLE likes
  ADD CONSTRAINT likes_from_user_fk FOREIGN KEY (from_user) REFERENCES profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT likes_to_user_fk FOREIGN KEY (to_user) REFERENCES profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE blocks
  ADD CONSTRAINT blocks_blocker_fk FOREIGN KEY (blocker) REFERENCES profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT blocks_blocked_fk FOREIGN KEY (blocked) REFERENCES profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE dating_opt_in
  ADD CONSTRAINT dating_opt_in_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
