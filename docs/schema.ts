/**
 * addis-date-spots — database schema (source of truth)
 *
 * Defined in Drizzle. `drizzle-kit generate` turns this into SQL migrations,
 * RLS policies included. The CLI writes through this (direct Postgres
 * connection, bypasses RLS); the web app reads `spots` via supabase-js under
 * the anon read policy declared below.
 *
 * See schemas.md for the human-readable companion, scoring formula, price
 * buckets, the LLM extraction (Zod) contract, and localStorage shape.
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

/* ------------------------------------------------------------------ */
/* channels — tracked review channels (CLI-internal, anon has no access)*/
/* ------------------------------------------------------------------ */

export const channels = pgTable(
  "channels",
  {
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
  },
).enableRLS(); // RLS on, no policy => only the RLS-bypassing CLI connection can touch it

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
