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
  check,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { anonRole } from "drizzle-orm/supabase";

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
    pgPolicy("public read spots", {
      for: "select",
      to: anonRole,
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
 * SECURITY: anon insert/update/delete is open for now because there is no auth
 * yet and the app isn't shared. When auth lands, scope these policies to
 * `auth.uid() = user_id` (and an "owner edits the null rows" grant). Until then,
 * do not treat this table as trusted input.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    googlePlaceId: text("google_place_id").notNull(), // -> spots.google_place_id
    userId: text("user_id"), // null = ours, for now (see note above)
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
    pgPolicy("public read visits", {
      for: "select",
      to: anonRole,
      using: sql`true`,
    }),
    pgPolicy("anon insert visits", {
      for: "insert",
      to: anonRole,
      withCheck: sql`true`,
    }),
    pgPolicy("anon update visits", {
      for: "update",
      to: anonRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
    pgPolicy("anon delete visits", {
      for: "delete",
      to: anonRole,
      using: sql`true`,
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
