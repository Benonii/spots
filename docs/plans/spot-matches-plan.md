# Spot Matches — plan

Taste-based people matching on top of the existing "want to go" (`saved_spots`)
list. Opt-in. Discovery is **spot-anchored**; reveal is **mutual-only**.

## Product loop (decided)

1. User opts in and picks one contact channel (email / telegram / instagram).
   Opting in makes them **both discoverable and able to discover** — symmetric.
   Non-opted users never appear and never see.
2. On a spot the user has saved, an inline line shows *"Sara +2 want to go here
   too"* — **first name + avatar**, only among other opted-in users. Capped
   (show 3, "+N more"); the list is **ranked by want-to-go overlap**, not raw.
3. Tapping a person shows *"You both want to go to 6 of the same places"* and a
   single **Like** button. Like is the only verb — "request" and "match back"
   are the same INSERT; a match is simply both like-rows existing.
4. On a mutual like, the pair appears in a **Matches** tab (unread count computed
   on load — no realtime, no notification subsystem) with the other person's
   chosen contact. Off-platform from there.

### Decided forks
- Pre-match identity: **first name + avatar** (reuses `profiles`, already
  community-feed-visible).
- Reveal surface: **Matches tab + unread badge** (no notification center).
- Discovery surface: **spot-anchored** (no people catalog / feed).
- **v1 is mutual-only**: a user can NOT see who liked them. Enforced by RLS
  (you can only read your *outgoing* likes; mutual detection is DEFINER-only).
  A "3 people want to go where you do" nudge is a deliberate **fast-follow**,
  not v1 — it's the one notch toward dating-app and we ship without it first.

## Security model (the part that matters)

Two hard boundaries, both server-enforced — the client never receives data that
crosses them:

1. **Raw want-to-go lists never leave the DB.** `saved_spots` RLS stays
   read-own-only, unchanged. Matching runs in a `SECURITY DEFINER` RPC that
   returns only *results* (matched user, overlap count) — never another user's
   list.
2. **Contact info is unreadable by the `authenticated` role except for a mutual
   match.** It lives in a **default-deny table** (RLS on, no cross-user select
   policy — same pattern as `channels`). Your own row is self-readable; other
   people's `contact_value` only ever surfaces through `my_matches()`, which is
   DEFINER and only emits contact for pairs with likes in both directions and no
   block either way.

"Who likes you" is protected the same structural way: `likes` SELECT policy is
`from_user = auth.uid()`, so incoming likes are invisible; only the DEFINER
`my_matches()` sees both directions.

## Data model (packages/db/src/schema.ts)

```
dating_opt_in
  user_id       text  pk  references profiles(id)   -- = auth.uid()
  contact_type  text  check in ('email','telegram','instagram')
  contact_value text
  active        boolean not null default true
  created_at / updated_at
  RLS: select/insert/update/delete WHERE user_id = auth.uid()  (own row only)
       NO cross-user select policy -> other rows unreadable to `authenticated`

likes
  from_user  text  references profiles(id)   -- auth.uid()
  to_user    text  references profiles(id)
  created_at
  unique (from_user, to_user);  check (from_user <> to_user)
  RLS: insert WHERE from_user = auth.uid()
       delete WHERE from_user = auth.uid()      -- allow unlike
       select WHERE from_user = auth.uid()      -- OUTGOING ONLY (never incoming)

blocks
  blocker  text  references profiles(id)   -- auth.uid()
  blocked  text  references profiles(id)
  created_at
  unique (blocker, blocked)
  RLS: insert/delete/select WHERE blocker = auth.uid()
```

No change to `saved_spots`, `profiles`, `visits`, `spots`.
(`profiles.dating_active` column was considered and rejected: keep the whole
opt-in concept, including the active flag, behind the single deny-by-default
`dating_opt_in` boundary rather than straddling a public-read table.)

## RPCs (hand-written migration, mirrors 0011/0015 style)

All: `LANGUAGE sql/plpgsql STABLE SECURITY DEFINER SET search_path = ''`,
fully-qualified names, `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO authenticated`.
Each internally gates on the caller being opted in; a non-opted caller gets zero
rows.

- `matches_for_spot(place_id text)` →
  `table(user_id text, display_name text, avatar_url text, overlap_count int, liked boolean)`
  Other opted-in users who saved `place_id`, minus the caller, minus anyone in a
  block relationship either direction. `overlap_count` = size of the intersection
  of the two users' `saved_spots.google_place_id` sets. `liked` = caller already
  liked them (for button state). Ordered by `overlap_count desc`. Gated on caller
  `dating_opt_in.active`.

- `my_matches()` →
  `table(user_id text, display_name text, avatar_url text, contact_type text, contact_value text, overlap_count int, matched_at timestamptz)`
  Pairs where likes exist in **both** directions and no block either way and both
  are still `active`. This is the ONLY place another user's `contact_value` is
  emitted. `matched_at` = max(created_at) of the two likes → drives the unread
  badge (compare against a client-stored last-seen timestamp; no server read
  state in v1).

Writes (`like`, `unlike`, `block`, opt-in upsert) go through plain RLS'd
INSERT/DELETE from supabase-js — no RPC needed, the policies above are sufficient.
Add `like` as an RPC only if we later want to reject likes against blockers
server-side (v1: a like row against a blocker is harmless — `my_matches` filters
it out).

## Client surface (apps/web)

- **Opt-in settings**: a small panel (where account/profile lives) — toggle
  `active`, pick channel + value. Uses existing input styles.
- **Spot-anchored strip**: on `SpotCard` for spots the user has saved, render
  `matches_for_spot(placeId)` results — avatar + first name row, capped, each
  opening a lightweight sheet with overlap sentence + Like/Unlike.
- **Matches tab**: new nav destination listing `my_matches()`; unread badge =
  count of `matched_at` newer than a `localStorage` last-seen stamp, cleared on
  visit. Each row shows contact with a copy affordance.
- **Empty/cold-start states**: opted-in-but-no-overlap, and not-opted-in
  (explains the feature + privacy: "only people who also opt in can see you").
- **Block / opt-out**: block from the person sheet; opt-out toggle in settings
  wipes `active` (and offers to delete the opt-in row = full disappearance).

## Safety (non-negotiable for v1)

- Block is instant + mutual invisibility (filtered in both RPCs).
- Opt-out removes you from everyone's `matches_for_spot` immediately (gate on
  `active`); "delete my dating data" hard-deletes the opt-in + likes rows.
- No contact string ever reaches the client pre-mutual (structural, above).
- Report is a fast-follow (block covers the immediate need for v1).

## Build order

1. schema.ts: 3 tables + RLS policies → `drizzle-kit generate` (migration N).
2. Hand-write migration N+1: the two DEFINER RPCs + REVOKE/GRANT.
3. **User applies migrations** (prod writes are user-run via `!`).
4. web: opt-in settings panel + types.
5. web: spot-anchored strip on SpotCard.
6. web: Matches tab + unread badge.
7. Empty states, block, opt-out.
8. Adversarial review (RLS leak paths, enumeration, contact exposure) before PR.

## Out of scope (explicit)
Chat; notification center/realtime; bios/photos beyond profiles; separate
request/approve flow; "who likes you" nudge (fast-follow); browsable people feed.
