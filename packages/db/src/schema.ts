/**
 * spots — database schema (source of truth)
 *
 * Defined in Drizzle. `drizzle-kit generate` turns this into SQL migrations,
 * RLS policies included. The CLI writes through this (direct Postgres
 * connection, bypasses RLS); the web app reads `spots` via supabase-js under
 * the anon read policy declared below.
 *
 * See docs/schemas.md for the human-readable companion, scoring formula, price
 * buckets, the LLM extraction (Zod) contract, and localStorage shape.
 *
 * D1 amendment (approved): `source_videos.extraction` and `source_videos.geo`
 * cache the per-video LLM output and Places result so normalize/geocode are
 * independently resumable and a spot's quality is recomputable from all of its
 * videos without re-calling the LLM. See docs/plans/cli-implementation-plan.md §7.
 */

import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  bigint,
  doublePrecision,
  numeric,
  smallint,
  integer,
  jsonb,
  index,
  uniqueIndex,
  check,
  pgPolicy,
  primaryKey,
} from "drizzle-orm/pg-core";
import { anonRole, authenticatedRole } from "drizzle-orm/supabase";

/* ------------------------------------------------------------------ */
/* jsonb sub-types                                                     */
/* ------------------------------------------------------------------ */

export type TopComment = {
  text: string;
  likes: number;
  author: string;
};

export type QualitySignals = {
  dimensions: {
    aesthetic: number; // 0..5
    vibe: number;
    food: number;
    value: number;
    service: number;
  };
  evidence: {
    positiveMentions: number;
    negativeMentions: number;
    aestheticMentions: number;
  };
};

/**
 * Raw per-video LLM output, cached on source_videos (D1). Structurally matches
 * the Zod `extractionSchema` in apps/cli/src/extraction.ts (asserted there).
 */
export type Extraction = {
  venueName: string | null;
  neighborhood: string | null;
  price: {
    min: number | null;
    max: number | null;
    currency: string;
    basis: "per_person" | "total" | "unknown";
  };
  tags: string[];
  summary: string;
  dimensions: QualitySignals["dimensions"];
  evidence: QualitySignals["evidence"];
};

/** Cached Google Places result for a video's venue (D1). */
export type GeoResult = {
  placeId: string;
  lat: number;
  lng: number;
  formattedAddress: string | null;
  priceLevel: number | null; // Places' coarse fallback bucket
};

/* ------------------------------------------------------------------ */
/* channels — tracked review channels (CLI-internal, anon has no access)*/
/* ------------------------------------------------------------------ */

export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").notNull().unique(), // '@addis_food_reviews'
  platform: text("platform").notNull().default("tiktok"),
  url: text("url").notNull(),
  displayName: text("display_name"),
  active: boolean("active").notNull().default(true),
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS(); // RLS on, no policy => only the RLS-bypassing CLI connection can touch it

/* ------------------------------------------------------------------ */
/* spots — deduped, normalized, geocoded venues (the only table the app reads) */
/* ------------------------------------------------------------------ */

export const spots = pgTable(
  "spots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    googlePlaceId: text("google_place_id").notNull().unique(), // dedup key
    name: text("name").notNull(),
    neighborhood: text("neighborhood"), // 'Bole', 'Kazanchis'
    address: text("address"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),

    // price (normalized)
    priceMin: numeric("price_min"),
    priceMax: numeric("price_max"),
    priceCurrency: text("price_currency").notNull().default("ETB"),
    priceBasis: text("price_basis").notNull().default("unknown"),
    priceLevel: smallint("price_level"), // 1..4, derived; null if no price

    // quality
    qualityScore: numeric("quality_score").notNull().default("0"), // 0..100, computed in CLI
    qualitySignals: jsonb("quality_signals")
      .$type<QualitySignals>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    summary: text("summary"),
    videoCount: integer("video_count").notNull().default(0),
    coverImageUrl: text("cover_image_url"),
    sourceVideoUrl: text("source_video_url"), // representative (top) video link

    // ── curation ──────────────────────────────────────────────────────────
    // 'scrape' = produced by the pipeline (keyed on a real google_place_id);
    // 'manual' = hand-added by an admin (id is 'manual:<uuid>', no videos).
    source: text("source").notNull().default("scrape"),
    // admin who owns this row. null for unclaimed scraped spots. Regular admins
    // may only edit/delete their own; supers may edit any.
    ownerId: text("owner_id"),
    // soft-delete / tombstone. A scraped spot can't be hard-deleted (the next
    // upsert would resurrect it from source_videos), so "removing" one = hidden.
    // Public reads filter these out; admins still see them to un-hide.
    hidden: boolean("hidden").notNull().default(false),
    mapUrl: text("map_url"), // pasted Google Maps link (manual spots' Maps button)
    // Suppresses the Maps button in the app while keeping map_url intact — some
    // scraped links point at the wrong place, but they're what we dedupe
    // against, so the link stays and only the button goes. Super-admin only in
    // practice: RLS already limits edits on scraped spots to supers.
    hideMap: boolean("hide_map").notNull().default(false),
    // names of columns an admin has edited; the scrape upsert skips these so
    // human edits are never reverted. See apps/cli/src/commands/upsert.ts.
    lockedFields: text("locked_fields")
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdBy: text("created_by"), // admin auth.uid() for manual spots; null for scrape
    updatedBy: text("updated_by"), // last admin to edit

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("spots_quality_idx").on(t.qualityScore.desc()),
    index("spots_price_level_idx").on(t.priceLevel),
    index("spots_neighborhood_idx").on(t.neighborhood),
    index("spots_tags_idx").using("gin", t.tags),
    check(
      "spots_price_basis_check",
      sql`${t.priceBasis} in ('per_person','total','unknown')`,
    ),
    check("spots_price_level_check", sql`${t.priceLevel} between 1 and 4`),
    // App-facing read access. Defining a policy auto-enables RLS on this table.
    // Both roles: anonymous-auth visitors carry the `authenticated` role, and a
    // first-time visitor reads spots before the anonymous sign-in completes.
    // Hidden (tombstoned) spots are filtered out of public reads.
    pgPolicy("public read spots", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`not ${t.hidden}`,
    }),
    // Admins additionally see hidden spots (to review / un-hide them). Multiple
    // permissive SELECT policies OR together, so this widens admin visibility.
    pgPolicy("admins read all spots", {
      for: "select",
      to: authenticatedRole,
      using: sql`is_admin()`,
    }),
    // Admins may create only manually-curated spots they own. The scraper writes
    // via the RLS-bypassing CLI connection, so it is unaffected by these.
    pgPolicy("admins insert manual spots", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`is_admin() and ${t.ownerId} = (select auth.uid())::text and ${t.source} = 'manual'`,
    }),
    // Supers edit any spot; regular admins edit only their own.
    pgPolicy("admins update own spots", {
      for: "update",
      to: authenticatedRole,
      using: sql`is_super_admin() or (is_admin() and ${t.ownerId} = (select auth.uid())::text)`,
      withCheck: sql`is_super_admin() or (is_admin() and ${t.ownerId} = (select auth.uid())::text)`,
    }),
    // Hard delete is restricted to MANUAL spots (a scraped row would resurrect on
    // the next upsert — "remove" a scraped spot by setting hidden=true instead).
    // Supers may delete any manual spot; regular admins only their own.
    pgPolicy("admins delete own manual spots", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${t.source} = 'manual' and (is_super_admin() or (is_admin() and ${t.ownerId} = (select auth.uid())::text))`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* visits — our (and eventually everyone's) check-ins + opinions on a spot */
/* ------------------------------------------------------------------ */

/**
 * The "Places we've been" log, persisted (was localStorage-only before).
 *
 * `userId` is nullable on purpose: today every row is ours, written with a null
 * user_id. Later we add auth, backfill the owner's id into the existing null
 * rows, and let other people add their own visits/comments — so this one table
 * cleanly splits into "where the owner has been" (our id) vs "general comments
 * from everybody" (their ids) without a schema change.
 *
 * The per-dimension sliders (aesthetic/vibe/food/portions/service) are our
 * subjective scores; null until rated. In the future these feed back into a
 * spot's overall rating + per-dimension scores alongside the data-derived ones.
 *
 * SECURITY: writes are owner-scoped via Google Auth — `user_id` defaults to the
 * caller's `auth.uid()` on insert, and insert/update/delete all require
 * `auth.uid() = user_id`, so you can only touch your own rows. READS are public:
 * notes are public reviews shown in the community "everyone's been" table, so
 * the select policy is open to any signed-in user. Author name/avatar for that
 * table come from the `profiles` table (joined on user_id). `user_id` stays
 * nullable so pre-auth rows survive; those legacy null-owner rows are filtered
 * out of the community feed.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    googlePlaceId: text("google_place_id").notNull(), // -> spots.google_place_id
    // owner of the row; stamped from the caller's JWT on insert. Nullable only
    // so pre-auth rows survive the migration (see note above). A column DEFAULT
    // can't be a subquery, so this is the bare function call (not `select`).
    userId: text("user_id").default(sql`(auth.uid())::text`),
    name: text("name").notNull(), // denormalized spot name for display
    visitedAt: text("visited_at").notNull(), // ISO date 'YYYY-MM-DD'
    rating: numeric("rating"), // overall 0..5 (stars); null = unrated
    notes: text("notes"),

    // subjective per-dimension sliders, 0..5; null = not yet given.
    aesthetic: numeric("aesthetic"),
    vibe: numeric("vibe"),
    food: numeric("food"),
    portions: numeric("portions"), // replaces "value" for our own scoring
    service: numeric("service"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("visits_place_idx").on(t.googlePlaceId),
    index("visits_user_idx").on(t.userId),
    // notes are public reviews — cap their length so a single row can't carry a
    // giant payload. NULL passes (unrated/no-note rows). Mirrored client-side by
    // the textarea maxLength in VisitedTable.
    check("visits_notes_len_check", sql`char_length(${t.notes}) <= 1000`),
    // Reads are PUBLIC: every signed-in user sees everyone's visits (the notes
    // are public reviews, surfaced in the community "everyone's been" table).
    // Writes stay owner-scoped — you can only insert/edit/delete your own rows.
    // `(select auth.uid())` is wrapped so Postgres caches it per-statement.
    // NB: the policy *names* are inherited from the pre-auth migration (hence
    // the now-inaccurate "anon" prefix) so drizzle-kit sees in-place changes
    // rather than renames — the latter need an interactive prompt to resolve.
    pgPolicy("public read visits", {
      for: "select",
      to: authenticatedRole,
      using: sql`true`,
    }),
    pgPolicy("anon insert visits", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select auth.uid())::text = ${t.userId}`,
    }),
    pgPolicy("anon update visits", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.userId}`,
      withCheck: sql`(select auth.uid())::text = ${t.userId}`,
    }),
    pgPolicy("anon delete visits", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.userId}`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* profiles — public display identity (name + avatar) for the community feed */
/* ------------------------------------------------------------------ */

/**
 * A public-readable display profile per user, so the community "everyone's been"
 * table can show who wrote a review. The client upserts its own row from the
 * Google session (name + avatar) on sign-in. We keep this separate from
 * `auth.users` (which isn't directly readable by the `authenticated` role) so
 * no SECURITY DEFINER view is needed — the feed just joins visits -> profiles.
 *
 * `id` equals `auth.uid()`. Anyone signed in can read all profiles (display data
 * only — no email); a user may only write their own (`auth.uid() = id`).
 *
 * `role` is the curation authority: 'user' (default) < 'admin' < 'super'. It lives
 * here so "who is an admin" travels with identity, but it is NOT user-writable:
 * the migration REVOKEs INSERT/UPDATE on this column from the `authenticated` role
 * (so the self-write policies below can't touch it and a user can't escalate
 * themselves), and the only way to change it is the SECURITY DEFINER `set_role()`
 * function, callable by supers (and the RLS-bypassing CLI for bootstrap). The
 * `is_admin()`/`is_super_admin()` helpers read this column with definer rights.
 */
export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(), // = auth.uid()
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    // curation role — write-locked at the column level (see migration); changed
    // only via set_role(). Default keeps every normal sign-up a plain user.
    role: text("role").notNull().default("user"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("profiles_role_check", sql`${t.role} in ('user','admin','super')`),
    pgPolicy("public read profiles", {
      for: "select",
      to: authenticatedRole,
      using: sql`true`,
    }),
    pgPolicy("insert own profile", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select auth.uid())::text = ${t.id}`,
    }),
    pgPolicy("update own profile", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.id}`,
      withCheck: sql`(select auth.uid())::text = ${t.id}`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* saved_spots — a user's private "want to go" bookmarks                */
/* ------------------------------------------------------------------ */

/**
 * One row per (user, spot) the user wants to visit later. PRIVATE — unlike
 * visits, only the owner can read their own list. `user_id` is stamped from the
 * caller's JWT on insert; a (user_id, google_place_id) unique constraint keeps
 * saves idempotent so a double-tap can't create duplicates.
 */
export const savedSpots = pgTable(
  "saved_spots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").default(sql`(auth.uid())::text`),
    googlePlaceId: text("google_place_id").notNull(), // -> spots.google_place_id
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("saved_user_place_idx").on(t.userId, t.googlePlaceId),
    pgPolicy("read own saved", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.userId}`,
    }),
    pgPolicy("insert own saved", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select auth.uid())::text = ${t.userId}`,
    }),
    pgPolicy("delete own saved", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.userId}`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* dating_opt_in — spot-matching opt-in + contact channel (private)      */
/* ------------------------------------------------------------------ */

/**
 * One row per user who has opted into spot-based people matching. Holds the
 * single contact channel that is revealed ONLY ON A MUTUAL MATCH. Deny-by-
 * default: the policies below grant a user access to THEIR OWN row and nothing
 * else, so another user's `contact_value` is unreadable to the `authenticated`
 * role through the API. A matched peer's contact is emitted solely by the
 * SECURITY DEFINER `my_matches()` function (see migration), which requires likes
 * in both directions and no block either way. `active` gates discoverability:
 * setting it false removes the user from everyone's matches immediately without
 * discarding their saved contact.
 */
export const datingOptIn = pgTable(
  "dating_opt_in",
  {
    userId: text("user_id")
      .primaryKey()
      .default(sql`(auth.uid())::text`), // = auth.uid(), -> profiles.id
    contactType: text("contact_type").notNull(),
    contactValue: text("contact_value").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "dating_contact_type_check",
      sql`${t.contactType} in ('email','telegram','instagram')`,
    ),
    // Own row only — no cross-user select. Other users' contact info is thus
    // invisible to `authenticated`; only my_matches() (DEFINER) emits it, and
    // only for a mutual match.
    pgPolicy("read own opt-in", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.userId}`,
    }),
    pgPolicy("insert own opt-in", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select auth.uid())::text = ${t.userId}`,
    }),
    pgPolicy("update own opt-in", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.userId}`,
      withCheck: sql`(select auth.uid())::text = ${t.userId}`,
    }),
    pgPolicy("delete own opt-in", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.userId}`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* likes — one-directional interest; mutual = a match                    */
/* ------------------------------------------------------------------ */

/**
 * A like row means the caller wants to match with `to_user`. There is no
 * separate "request" vs "accept" — a match is simply two like rows in opposite
 * directions. CRUCIALLY the select policy exposes only OUTGOING likes
 * (`from_user = auth.uid()`); a user cannot see who has liked them. Mutual
 * detection happens only inside the DEFINER `my_matches()`, which keeps v1
 * mutual-only. Unlike = delete your own row.
 */
export const likes = pgTable(
  "likes",
  {
    fromUser: text("from_user")
      .notNull()
      .default(sql`(auth.uid())::text`),
    toUser: text("to_user").notNull(), // -> profiles.id
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.fromUser, t.toUser] }),
    index("likes_to_user_idx").on(t.toUser), // reverse lookup in my_matches()
    check("likes_no_self_check", sql`${t.fromUser} <> ${t.toUser}`),
    pgPolicy("insert own like", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select auth.uid())::text = ${t.fromUser}`,
    }),
    pgPolicy("delete own like", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.fromUser}`,
    }),
    // OUTGOING ONLY. Incoming likes stay invisible; my_matches() (DEFINER) is
    // the sole path that reads both directions.
    pgPolicy("read own outgoing likes", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.fromUser}`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* blocks — hide two users from each other in matching                   */
/* ------------------------------------------------------------------ */

/**
 * `blocker` no longer wants to see or be seen by `blocked`. Both
 * matches_for_spot() and my_matches() exclude any pair with a block row in
 * EITHER direction, so a block is effectively mutual invisibility. A user reads,
 * creates, and removes only their own block rows.
 */
export const blocks = pgTable(
  "blocks",
  {
    blocker: text("blocker")
      .notNull()
      .default(sql`(auth.uid())::text`),
    blocked: text("blocked").notNull(), // -> profiles.id
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blocker, t.blocked] }),
    pgPolicy("manage own blocks", {
      for: "all",
      to: authenticatedRole,
      using: sql`(select auth.uid())::text = ${t.blocker}`,
      withCheck: sql`(select auth.uid())::text = ${t.blocker}`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* feedback — bug reports, feature requests, general notes from anyone   */
/* ------------------------------------------------------------------ */

/**
 * Free-form feedback submitted from the app's "Send feedback" modal. Open to
 * everyone — a visitor doesn't need to sign in to report a bug or suggest a
 * feature — so the insert policy covers both anon and authenticated roles.
 *
 * `userId` is stamped from the caller's JWT when signed in (null for anon); we
 * never trust a client-supplied id (the withCheck enforces null-or-own). There
 * is intentionally NO select policy: with RLS on, that means nobody can read
 * feedback through the API. The owner reads it via the RLS-bypassing CLI/Studio
 * connection (or the Supabase dashboard). `email` is optional so we can follow
 * up; `pageUrl`/`userAgent` give a bug report just enough context to reproduce.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull().default("general"), // 'bug' | 'feature' | 'general'
    message: text("message").notNull(),
    email: text("email"), // optional reply-to
    userId: text("user_id").default(sql`(auth.uid())::text`), // null for anon
    pageUrl: text("page_url"), // path the user was on
    userAgent: text("user_agent"), // browser/device, for repro
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("feedback_created_idx").on(t.createdAt.desc()),
    check("feedback_kind_check", sql`${t.kind} in ('bug','feature','general')`),
    // bound the payload so one row can't carry a giant blob; mirrored by the
    // textarea maxLength client-side.
    check(
      "feedback_message_len_check",
      sql`char_length(${t.message}) between 1 and 2000`,
    ),
    // Anyone (signed in or not) may submit; a client may only stamp its own
    // user_id (or leave it null). No select policy => nobody reads via the API.
    pgPolicy("anyone insert feedback", {
      for: "insert",
      to: [anonRole, authenticatedRole],
      withCheck: sql`${t.userId} is null or (select auth.uid())::text = ${t.userId}`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* events — first-party product analytics (page views + feature usage)   */
/* ------------------------------------------------------------------ */

/**
 * A lightweight append-only event stream for product analytics — page views and
 * feature usage — so we can compute DAU/MAU and "most-used features" with plain
 * SQL (see packages/db/analytics.sql, or `spots analytics`).
 *
 * Actors are STITCHED at query time (see analytics.sql): signed-in users get
 * their stable `auth.uid()` (stamped server-side), anyone else a client-generated
 * `anon_id` (localStorage), and any anon_id that ever co-occurred with a user_id
 * counts as that user — naive coalesce() double-counts people. Since our audience is
 * Addis Ababa (outside the EU cookie-consent regime) we track anonymous visitors
 * too, which is what makes whole-population DAU/MAU possible.
 *
 * RLS mirrors `feedback`: anon + authenticated may INSERT (a client can only
 * stamp its own user_id, or leave it null); there is NO select policy, so the
 * stream is write-only from the browser and only the RLS-bypassing CLI/Studio
 * connection can read or aggregate it. No PII beyond the optional auth id.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // 'page_view', 'feedback_submit', 'surprise', …
    props: jsonb("props").$type<Record<string, unknown>>(), // optional event detail
    userId: text("user_id").default(sql`(auth.uid())::text`), // null for anon
    anonId: text("anon_id"), // stable per-device id (localStorage), for anon DAU/MAU
    path: text("path"), // route the event fired on
    userAgent: text("user_agent"), // best-effort UA string, for bot filtering
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("events_created_idx").on(t.createdAt.desc()),
    index("events_name_idx").on(t.name),
    // DAU/MAU groups by day and counts distinct actor; speeds the actor scan.
    index("events_actor_idx").on(t.userId, t.anonId),
    pgPolicy("anyone insert events", {
      for: "insert",
      to: [anonRole, authenticatedRole],
      withCheck: sql`${t.userId} is null or (select auth.uid())::text = ${t.userId}`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* suppressed_places — google_place_ids a super-admin permanently killed     */
/* ------------------------------------------------------------------ */

/**
 * A scraped spot can't just be deleted — the next `spots upsert` would re-create
 * it from its source_videos. So "permanent delete" (super only) records the
 * place id here and removes the spots row, atomically, via the SECURITY DEFINER
 * purge_spot() function (see migration). The upsert skips any place id listed
 * here, so it never comes back. RLS on, no policy => only the function (definer)
 * and the RLS-bypassing CLI connection touch it.
 */
export const suppressedPlaces = pgTable("suppressed_places", {
  googlePlaceId: text("google_place_id").primaryKey(),
  reason: text("reason"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/* ------------------------------------------------------------------ */
/* source_videos — raw per-video provenance (CLI-internal, anon has no access) */
/* ------------------------------------------------------------------ */

export const sourceVideos = pgTable(
  "source_videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    spotId: uuid("spot_id").references(() => spots.id, {
      onDelete: "set null",
    }), // set after normalize + geocode
    platformVideoId: text("platform_video_id").notNull().unique(),
    url: text("url").notNull(),
    caption: text("caption"),
    hashtags: text("hashtags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    viewCount: bigint("view_count", { mode: "number" }),
    likeCount: bigint("like_count", { mode: "number" }),
    commentCount: bigint("comment_count", { mode: "number" }),
    shareCount: bigint("share_count", { mode: "number" }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    thumbnailUrl: text("thumbnail_url"),
    topComments: jsonb("top_comments")
      .$type<TopComment[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // null = comments stage hasn't run; distinguishes "not fetched" from
    // "fetched, zero comments" so we don't re-spend ScrapFly credits.
    commentsScrapedAt: timestamp("comments_scraped_at", { withTimezone: true }),

    // D1: per-video caches — null until the corresponding stage runs.
    extraction: jsonb("extraction").$type<Extraction>(), // null = needs normalization
    geo: jsonb("geo").$type<GeoResult>(), // result of geocoding; null if not found
    // null = geocode stage hasn't run for this row; distinguishes "not attempted"
    // from "attempted, no Places match" so we don't re-spend Places quota.
    geocodedAt: timestamp("geocoded_at", { withTimezone: true }),

    scrapedAt: timestamp("scraped_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    normalizedAt: timestamp("normalized_at", { withTimezone: true }), // null = needs normalization
  },
  (t) => [
    index("source_videos_spot_idx").on(t.spotId),
    index("source_videos_unnormalized_idx")
      .on(t.normalizedAt)
      .where(sql`${t.normalizedAt} is null`),
    // comments work-list — videos not yet sent through ScrapFly.
    index("source_videos_uncommented_idx")
      .on(t.commentsScrapedAt)
      .where(sql`${t.commentsScrapedAt} is null`),
    // geocode work-list — videos not yet sent through Places.
    index("source_videos_ungeocoded_idx")
      .on(t.geocodedAt)
      .where(sql`${t.geocodedAt} is null`),
  ],
).enableRLS(); // RLS on, no policy => CLI-only

/* ------------------------------------------------------------------ */
/* happenings — time-bound events scraped from Telegram                */
/* ------------------------------------------------------------------ */

/**
 * Concerts, pop-ups, screenings, exhibitions — things that expire.
 *
 * Deliberately NOT in `spots`: a spot is a permanent venue and is never
 * filtered by date, whereas a happening is worthless the day after it runs.
 * The 12 event-tagged rows currently sitting in `spots` are that mistake.
 * Also deliberately not named `events` — that name belongs to the analytics
 * stream (insert-only, no select policy), so a product table called `events`
 * would be unreadable by the app.
 *
 * Source is the public Telegram preview page (t.me/s/<channel>) — no API key,
 * no bot membership, and none of TikTok's rate-limit hostility. One row per
 * message, inserted raw first and enriched by a separate extraction stage, so
 * the scrape is free to re-run and only the LLM stage costs money.
 *
 * Lifecycle: pending -> published | rejected. Nothing reaches the app until a
 * human (or a high-confidence extraction) moves it to 'published'.
 */
export const happenings = pgTable(
  "happenings",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // ── source (set by the poller) ────────────────────────────────────────
    // channel handle without the '@', lowercased: 'linkupaddis'. Kept as a
    // plain string rather than a channels FK: `channels` is TikTok-shaped and
    // its rows feed the video pipeline's work-lists.
    sourceChannel: text("source_channel").notNull(),
    // Telegram's per-channel message id. Monotonic, so it doubles as the
    // pagination cursor (t.me/s/<channel>?before=<id>).
    sourceMessageId: bigint("source_message_id", { mode: "number" }).notNull(),
    sourceUrl: text("source_url").notNull(), // https://t.me/linkupaddis/12889
    rawText: text("raw_text").notNull(), // the post verbatim, for re-extraction
    imageUrl: text("image_url"), // the post's photo, if it has one
    postedAt: timestamp("posted_at", { withTimezone: true }),

    // ── extraction (set by the LLM stage; all null until it runs) ─────────
    title: text("title"),
    summary: text("summary"),
    venueName: text("venue_name"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    priceMin: numeric("price_min"),
    priceMax: numeric("price_max"),
    priceCurrency: text("price_currency").notNull().default("ETB"),
    ticketUrl: text("ticket_url"),
    // The channel posts plenty of non-events (job ads, course announcements,
    // news). This is the gate that keeps them out, separate from `confidence`:
    // a post can be confidently not-an-event.
    isEvent: boolean("is_event"),
    confidence: numeric("confidence"), // 0..1, drives auto-publish vs review
    // null = the extraction stage hasn't run. Stamped even when extraction
    // fails, so a re-run never re-bills the same post. Same rule as
    // comments_scraped_at / normalized_at / geocoded_at on source_videos.
    extractedAt: timestamp("extracted_at", { withTimezone: true }),

    // Set when the venue is already in the catalog — "jazz night at a place
    // you already saved" is the thing a plain Telegram mirror can't do.
    spotId: uuid("spot_id").references(() => spots.id, { onDelete: "set null" }),

    // ── review ───────────────────────────────────────────────────────────
    status: text("status").notNull().default("pending"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"), // admin auth.uid(), or null when auto-published
    rejectedReason: text("rejected_reason"),

    scrapedAt: timestamp("scraped_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Dedup key. Message ids are only unique within a channel, so the pair is
    // what makes a re-poll idempotent.
    uniqueIndex("happenings_source_idx").on(t.sourceChannel, t.sourceMessageId),
    // The app's only query: published, not yet over, soonest first.
    index("happenings_upcoming_idx")
      .on(t.startsAt)
      .where(sql`status = 'published'`),
    // Extraction work-list — posts the LLM stage hasn't seen.
    index("happenings_unextracted_idx")
      .on(t.extractedAt)
      .where(sql`extracted_at is null`),
    // Review queue.
    index("happenings_status_idx").on(t.status),
    check(
      "happenings_status_check",
      sql`${t.status} in ('pending','published','rejected')`,
    ),
    check("happenings_confidence_check", sql`${t.confidence} between 0 and 1`),
    // The correctness property the whole feature rests on: an undated event
    // can never go live, because the app filters on starts_at and a null would
    // silently drop out of both the upcoming and the expired side. Enforced
    // here rather than in the publish path so no future caller can skip it.
    check(
      "happenings_published_needs_start",
      sql`${t.status} <> 'published' or ${t.startsAt} is not null`,
    ),
    // Public reads see published happenings only — including ones already past,
    // which the app filters by date. Expiry is a query predicate, not a status.
    pgPolicy("public read happenings", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`${t.status} = 'published'`,
    }),
    // Admins additionally see pending/rejected rows. Writes stay CLI-only: the
    // review queue is a CLI command, so there is no insert/update policy here.
    pgPolicy("admins read all happenings", {
      for: "select",
      to: authenticatedRole,
      using: sql`is_admin()`,
    }),
    // The scheduled poller runs in CI under a least-privilege login rather than
    // the RLS-bypassing CLI connection, so it needs policies of its own —
    // scoped to exactly what the poll command does: read the dedup key, insert
    // pending rows. A leaked POLLER_DATABASE_URL therefore can't touch
    // published content. See drizzle/0023_poller_role.sql (creates the role;
    // password set out of band) and 0024_tighten_poller.sql (this shape).
    pgPolicy("poller reads happenings", {
      for: "select",
      to: "spots_poller",
      using: sql`true`,
    }),
    pgPolicy("poller inserts pending happenings", {
      for: "insert",
      to: "spots_poller",
      withCheck: sql`${t.status} = 'pending'`,
    }),
  ],
);

/* ------------------------------------------------------------------ */
/* relations (typed joins)                                             */
/* ------------------------------------------------------------------ */

export const channelsRelations = relations(channels, ({ many }) => ({
  videos: many(sourceVideos),
}));

export const spotsRelations = relations(spots, ({ many }) => ({
  videos: many(sourceVideos),
}));

export const happeningsRelations = relations(happenings, ({ one }) => ({
  spot: one(spots, {
    fields: [happenings.spotId],
    references: [spots.id],
  }),
}));

export const sourceVideosRelations = relations(sourceVideos, ({ one }) => ({
  channel: one(channels, {
    fields: [sourceVideos.channelId],
    references: [channels.id],
  }),
  spot: one(spots, {
    fields: [sourceVideos.spotId],
    references: [spots.id],
  }),
}));

/* ------------------------------------------------------------------ */
/* inferred types — share these with the frontend too                 */
/* ------------------------------------------------------------------ */

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;

export type Spot = typeof spots.$inferSelect;
export type NewSpot = typeof spots.$inferInsert;

export type SourceVideo = typeof sourceVideos.$inferSelect;
export type NewSourceVideo = typeof sourceVideos.$inferInsert;

export type Happening = typeof happenings.$inferSelect;
export type NewHappening = typeof happenings.$inferInsert;

export type Visit = typeof visits.$inferSelect;
export type NewVisit = typeof visits.$inferInsert;

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Role = Profile["role"]; // 'user' | 'admin' | 'super' (string at the type level)

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;

export type AnalyticsEvent = typeof events.$inferSelect;
export type NewAnalyticsEvent = typeof events.$inferInsert;

export type SuppressedPlace = typeof suppressedPlaces.$inferSelect;
export type NewSuppressedPlace = typeof suppressedPlaces.$inferInsert;

export type DatingOptIn = typeof datingOptIn.$inferSelect;
export type NewDatingOptIn = typeof datingOptIn.$inferInsert;

export type Like = typeof likes.$inferSelect;
export type NewLike = typeof likes.$inferInsert;

export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;
