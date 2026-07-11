-- Spot Matches — opt-in, spot-anchored, mutual-only people matching.
--
-- Three tables + two SECURITY DEFINER RPCs. The security model rests on two
-- server boundaries the client never crosses:
--   1. Raw want-to-go lists never leave the DB. saved_spots RLS is unchanged
--      (read-own-only); overlap is computed inside the definer functions and
--      only the *count* is returned.
--   2. contact_value is unreadable by `authenticated` except your own row; a
--      matched peer's contact is emitted solely by my_matches(), which requires
--      reciprocal likes and no block either way.
-- "Who likes you" is protected the same way: likes' SELECT policy exposes only
-- outgoing rows, so mutual detection lives only in the definer my_matches().

CREATE TABLE IF NOT EXISTS "dating_opt_in" (
  "user_id" text PRIMARY KEY NOT NULL DEFAULT (auth.uid())::text,
  "contact_type" text NOT NULL,
  "contact_value" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dating_contact_type_check" CHECK ("contact_type" in ('email','telegram','instagram'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "likes" (
  "from_user" text NOT NULL DEFAULT (auth.uid())::text,
  "to_user" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "likes_from_user_to_user_pk" PRIMARY KEY ("from_user","to_user"),
  CONSTRAINT "likes_no_self_check" CHECK ("from_user" <> "to_user")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blocks" (
  "blocker" text NOT NULL DEFAULT (auth.uid())::text,
  "blocked" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "blocks_blocker_blocked_pk" PRIMARY KEY ("blocker","blocked")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "likes_to_user_idx" ON "likes" ("to_user");
--> statement-breakpoint
ALTER TABLE "dating_opt_in" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "likes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- dating_opt_in: own row only. No cross-user select => other users' contact info
-- is invisible to `authenticated`; my_matches() (definer) is the only path that
-- emits a peer's contact, and only on a mutual match.
CREATE POLICY "read own opt-in" ON "dating_opt_in" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid())::text = "user_id");
--> statement-breakpoint
CREATE POLICY "insert own opt-in" ON "dating_opt_in" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid())::text = "user_id");
--> statement-breakpoint
CREATE POLICY "update own opt-in" ON "dating_opt_in" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid())::text = "user_id") WITH CHECK ((select auth.uid())::text = "user_id");
--> statement-breakpoint
CREATE POLICY "delete own opt-in" ON "dating_opt_in" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid())::text = "user_id");
--> statement-breakpoint
-- likes: insert/delete your own; SELECT is OUTGOING ONLY (from_user = you), so a
-- user can never see who liked them. Mutual detection is definer-only.
CREATE POLICY "insert own like" ON "likes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid())::text = "from_user");
--> statement-breakpoint
CREATE POLICY "delete own like" ON "likes" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid())::text = "from_user");
--> statement-breakpoint
CREATE POLICY "read own outgoing likes" ON "likes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid())::text = "from_user");
--> statement-breakpoint
-- blocks: read/create/remove only your own.
CREATE POLICY "manage own blocks" ON "blocks" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid())::text = "blocker") WITH CHECK ((select auth.uid())::text = "blocker");
--> statement-breakpoint
-- Other opted-in users who also want to go to `place_id`, ranked by how much of
-- their want-to-go list overlaps with the caller's. Returns only counts, never
-- another user's list. Excludes the caller, anyone in a block relationship
-- either direction, and (via the caller-active guard) yields nothing unless the
-- caller is opted in. `liked` reflects the caller's outgoing like for button state.
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
  JOIN public.profiles p ON p.id = o.user_id
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
REVOKE ALL ON FUNCTION matches_for_spot(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION matches_for_spot(text) TO authenticated;
--> statement-breakpoint
-- Confirmed matches: pairs with likes in BOTH directions, both still active, and
-- no block either way. This is the ONLY place another user's contact_value is
-- emitted. matched_at = the later of the two likes, for the client-side unread
-- badge (compared against a locally-stored last-seen stamp; no server read state).
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
  JOIN public.profiles p ON p.id = lout.to_user
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
