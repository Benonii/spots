/**
 * date-finder — database schema (source of truth)
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
    pgPolicy("public read spots", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`true`,
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
 */
export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(), // = auth.uid()
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
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
 * Every actor is identified by `coalesce(user_id, anon_id)`: signed-in users get
 * their stable `auth.uid()` (stamped server-side); everyone else carries a
 * client-generated `anon_id` persisted in localStorage. Since our audience is
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
/* relations (typed joins)                                             */
/* ------------------------------------------------------------------ */

export const channelsRelations = relations(channels, ({ many }) => ({
  videos: many(sourceVideos),
}));

export const spotsRelations = relations(spots, ({ many }) => ({
  videos: many(sourceVideos),
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

export type Visit = typeof visits.$inferSelect;
export type NewVisit = typeof visits.$inferInsert;

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;

export type AnalyticsEvent = typeof events.$inferSelect;
export type NewAnalyticsEvent = typeof events.$inferInsert;
