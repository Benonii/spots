# addis-date-spots — Schemas

> **`schema.ts` (Drizzle) is the source of truth for the database.** This document is the human-readable companion: it explains the tables, and owns the LLM extraction contract, the scoring formula, price buckets, and client-side state — the parts that don't live in Drizzle. The SQL DDL shown below is *illustrative* of what `drizzle-kit generate` produces; don't hand-apply it. Pairs with `architecture.md`.

**Conventions:** Postgres (Supabase), `uuid` primary keys (`gen_random_uuid()`), `timestamptz` timestamps, `snake_case` columns. The app reads **only** `spots`; `channels` and `source_videos` are CLI-internal. Schema and migrations are managed by Drizzle; RLS policies are declared in `schema.ts` via `pgPolicy` and generated into migrations.

---

## 0. Drizzle setup

The schema lives in `schema.ts`. Two pieces of glue:

**`drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Required so drizzle-kit emits the RLS policies declared in schema.ts:
  entities: { roles: { provider: "supabase" } },
});
```

**`db.ts` (CLI only — never imported by the frontend)**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// prepare:false only needed if you use Supabase's transaction-mode pooler;
// the direct/session connection string doesn't require it.
const client = postgres(process.env.DATABASE_URL!, { prepare: false });
export const db = drizzle({ client, schema });
```

**Migrations:** `drizzle-kit generate` (schema diff → SQL migration, RLS included) then `drizzle-kit migrate` (apply). Use `drizzle-kit push` for fast local iteration.

**Access split:** the CLI writes via `db` above (direct Postgres connection, bypasses RLS). The web app reads `spots` via `@supabase/supabase-js` (anon key, RLS-enforced). Two access paths, one boundary: writer vs. reader.

---

## 1. Tables

> Defined in `schema.ts`. SQL below is illustrative of the generated output.

### 1.1 `channels`

Review channels being tracked.

```sql
create table channels (
  id              uuid primary key default gen_random_uuid(),
  handle          text not null unique,              -- e.g. '@addis_food_reviews'
  platform        text not null default 'tiktok',
  url             text not null,
  display_name    text,
  active          boolean not null default true,
  last_scraped_at timestamptz,
  created_at      timestamptz not null default now()
);
```

### 1.2 `source_videos`

Raw per-video provenance from yt-dlp + comments. Lets you re-normalize without re-scraping and trace any spot back to its sources.

```sql
create table source_videos (
  id                uuid primary key default gen_random_uuid(),
  channel_id        uuid not null references channels(id) on delete cascade,
  spot_id           uuid references spots(id) on delete set null,  -- set after normalize+geocode
  platform_video_id text not null unique,            -- TikTok video id from yt-dlp
  url               text not null,
  caption           text,
  hashtags          text[] not null default '{}',
  view_count        bigint,
  like_count        bigint,
  comment_count     bigint,
  share_count       bigint,
  posted_at         timestamptz,
  thumbnail_url     text,
  top_comments      jsonb not null default '[]',     -- [{ text, likes, author }]
  scraped_at        timestamptz not null default now(),
  normalized_at     timestamptz                      -- null = needs normalization
);
```

> `spots` is referenced above; create `spots` first or add the FK after. The ordering below (channels → spots → source_videos) avoids the forward reference.

### 1.3 `spots`

The deduped, normalized, geocoded venues. **This is the only table the app reads.**

```sql
create table spots (
  id              uuid primary key default gen_random_uuid(),
  google_place_id text not null unique,              -- dedup key
  name            text not null,
  neighborhood    text,                              -- e.g. 'Bole', 'Kazanchis'
  address         text,
  lat             double precision not null,
  lng             double precision not null,

  -- price (normalized)
  price_min       numeric,                           -- null if no price found
  price_max       numeric,                           -- null unless a range was stated
  price_currency  text not null default 'ETB',
  price_basis     text not null default 'unknown'
                    check (price_basis in ('per_person','total','unknown')),
  price_level     smallint check (price_level between 1 and 4),  -- derived bucket, null if no price

  -- quality
  quality_score   numeric not null default 0,        -- 0..100, computed in CLI
  quality_signals jsonb   not null default '{}',     -- structured LLM output (see §3)

  tags            text[]  not null default '{}',     -- ['rooftop','coffee','quiet']
  summary         text,                              -- one-line blurb
  video_count     int     not null default 0,        -- # source videos mentioning it
  cover_image_url text,

  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

**Create order:** `channels`, then `spots`, then `source_videos`.

---

## 2. Indexes

```sql
create index spots_quality_idx      on spots (quality_score desc);
create index spots_price_level_idx  on spots (price_level);
create index spots_neighborhood_idx on spots (neighborhood);
create index spots_tags_idx         on spots using gin (tags);

create index source_videos_spot_idx       on source_videos (spot_id);
create index source_videos_unnormalized_idx on source_videos (normalized_at)
  where normalized_at is null;
```

`channels.handle`, `source_videos.platform_video_id`, and `spots.google_place_id` are already unique-indexed via their constraints.

---

## 3. `quality_signals` (jsonb) + scoring

The LLM returns per-dimension scores and evidence counts; the **CLI computes the final `quality_score` deterministically** so it's debuggable.

### Stored shape

```json
{
  "dimensions": { "aesthetic": 4.5, "vibe": 4.0, "food": 3.5, "value": 4.0, "service": 3.0 },
  "evidence":   { "positiveMentions": 18, "negativeMentions": 2, "aestheticMentions": 9 }
}
```

Each dimension is `0..5`, aggregated by the model over caption + top comments (negation handled).

### Scoring formula (CLI, deterministic)

```
weights         = { aesthetic: 1.0, vibe: 1.0, food: 1.0, value: 1.2, service: 0.8 }
base            = Σ(wᵢ · dᵢ) / Σ(wᵢ)                 // 0..5, over dimensions present
evidenceFactor  = 0.85 + 0.05 · min(video_count, 3)  // 0.90 (1 video) → 1.00 (3+ videos)
quality_score   = clamp( round( base · 20 · evidenceFactor ), 0, 100 )
```

`evidenceFactor` gives a small bump to well-corroborated spots without letting volume dominate quality. Weights and the factor are tunable once you see real data.

---

## 4. Price normalization

The LLM extracts `{ min, max, currency, basis }`. The CLI derives `price_level`:

1. Take per-person price. If `basis = 'total'`, divide by 2 (date = 2 people, a heuristic).
2. Use `price_min` (or the midpoint of a range) for bucketing.

| `price_level` | Label | Per-person ETB |
|---|---|---|
| 1 | $    | < 300 |
| 2 | $$   | 300 – 700 |
| 3 | $$$  | 700 – 1500 |
| 4 | $$$$ | > 1500 |

`price_level` is `null` when no price was found. Buckets are tunable against real Addis data.

---

## 5. LLM extraction contract (Zod)

The exact object `generateObject` must return, one call per video. Maps directly onto `spots` + `quality_signals`.

```ts
import { z } from "zod";

export const extractionSchema = z.object({
  venueName:    z.string().nullable(),        // null if no identifiable place named
  neighborhood: z.string().nullable(),

  price: z.object({
    min:      z.number().nullable(),
    max:      z.number().nullable(),          // null unless a range was stated
    currency: z.string().default("ETB"),
    basis:    z.enum(["per_person", "total", "unknown"]),
  }),

  tags:    z.array(z.string()),               // e.g. ['rooftop','coffee']
  summary: z.string(),                        // one-line blurb

  dimensions: z.object({
    aesthetic: z.number().min(0).max(5),
    vibe:      z.number().min(0).max(5),
    food:      z.number().min(0).max(5),
    value:     z.number().min(0).max(5),
    service:   z.number().min(0).max(5),
  }),

  evidence: z.object({
    positiveMentions:  z.number().int(),
    negativeMentions:  z.number().int(),
    aestheticMentions: z.number().int(),
  }),
});

export type Extraction = z.infer<typeof extractionSchema>;
```

Run with `temperature: 0`. Rows where `venueName` is `null` are skipped (no geocode target).

---

## 6. Client-side state — `localStorage`

Visited tracking, single-user, no auth. One key holding an array.

**Key:** `addis-date-spots:visited`

```ts
type VisitedEntry = {
  placeId:   string;   // spots.google_place_id
  name:      string;
  visitedAt: string;   // ISO date
  rating?:   number;   // 1..5, optional personal rating
  notes?:    string;
};

type VisitedStore = VisitedEntry[];
```

The random picker and "been here" badges read this; the picker excludes any `placeId` present here.

---

## 7. Row-Level Security

RLS is **declared in `schema.ts`**, not applied by hand — `drizzle-kit generate` emits these into a migration (with `entities.roles.provider: "supabase"` set in the config). The app (anon role) may read **only** `spots`; `channels` and `source_videos` have RLS enabled with no policy, so anon is denied. The CLI connects via the direct Postgres connection (table-owner role), which bypasses RLS and performs all writes.

In Drizzle this is: a `pgPolicy("public read spots", { for: "select", to: anonRole, using: sql\`true\` })` on `spots` (which auto-enables RLS on that table), and `.enableRLS()` on `channels` and `source_videos`. The `anonRole` comes from `drizzle-orm/supabase`.

The generated SQL is equivalent to:

```sql
-- spots: public read
alter table spots enable row level security;
create policy "public read spots" on spots for select to anon using (true);

-- channels / source_videos: RLS on, no policy => anon denied, CLI (owner) bypasses
alter table channels      enable row level security;
alter table source_videos enable row level security;
```

---

## 8. Future: `visits` table (post-auth, not v0)

When visited needs to sync across devices, migrate `localStorage` → this table behind auth. It would be added to `schema.ts` (with its `pgPolicy` rules) like the others; the SQL below is just the shape.

```sql
-- create table visits (
--   id         uuid primary key default gen_random_uuid(),
--   user_id    uuid not null references auth.users(id) on delete cascade,
--   spot_id    uuid not null references spots(id) on delete cascade,
--   visited_at date not null default current_date,
--   rating     smallint check (rating between 1 and 5),
--   notes      text,
--   created_at timestamptz not null default now(),
--   unique (user_id, spot_id)
-- );
-- RLS: users select/insert/update/delete only where user_id = auth.uid().
```
