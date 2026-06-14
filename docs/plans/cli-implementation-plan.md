# CLI Implementation Plan — Ingestion Pipeline

> Scope: the **ingestion CLI** only. The TanStack Router frontend is initialized as a
> stub separately; its real design lands later. This plan turns `architecture.md`,
> `schemas.md`, and `schema.ts` into a concrete, build-ready sequence.
>
> Source of truth for data shapes: `docs/schema.ts` (DB) + `docs/schemas.md` §3–§5
> (scoring, price buckets, LLM contract). This plan does not redefine those — it wires
> them into runnable stages and flags the few places where the docs leave a decision open.

---

## 0. TL;DR — what gets built

A Bun + TypeScript CLI that runs six idempotent, individually-resumable stages:

```
channels → scrape (yt-dlp) → comments (ScrapFly) → normalize (LLM) → geocode (Places) → upsert (spots)
```

State lives entirely in Postgres (Supabase). Every stage reads its work-list from the DB
and writes results back, so any stage can be re-run, resumed after a crash, or replayed
after tuning a prompt/weight **without re-scraping**. That resumability is the central
design constraint and it shapes every decision below.

---

## 1. What is required of you (prerequisites & decisions)

Nothing in this section is something I can do for you. Grouped by type.

### 1.1 Local installs
| Item | Status | Action |
|---|---|---|
| Bun ≥ 1.2 | ✅ installed (1.2.12) | — |
| ffmpeg | ✅ installed | — |
| **yt-dlp** | ❌ **missing** | `pipx install yt-dlp` (preferred, easy to keep current) or `sudo pacman -S yt-dlp`. TikTok extractor changes often — plan to `yt-dlp -U` before a big run. |
| git | ✅ installed | repo is **not** initialized yet — `git init` when we scaffold |

### 1.2 Accounts & API keys (all CLI-side, none ship to the browser)
| Key / value | Where to get it | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → **Direct connection** (port 5432) | Used by Drizzle for migrations *and* CLI writes; bypasses RLS. Use the direct/session string, not the transaction pooler, for migrations. |
| `SUPABASE_SECRET_KEY` | Supabase → API settings | Held by CLI; not strictly needed if we write purely via the Postgres connection, but keep it available. |
| `SUPABASE_PUBLISHABLE_KEY` + `SUPABASE_URL` | Supabase → API settings | **For the frontend later**, not the CLI. Note them now. |
| `GOOGLE_PLACES_API_KEY` | Google Cloud Console → enable **Places API (New)** → create key → **enable billing** | Geocoding. Free monthly credit covers v0 volume, but billing must be on or calls 403. |
| `LLM_MODEL` + `LLM_API_KEY` | provider dashboard (OpenAI or Google AI Studio) | Provider-agnostic. `LLM_MODEL` is `"<provider>:<model-id>"` (e.g. `openai:gpt-5.1` or `google:gemini-3-flash`); `LLM_API_KEY` is that provider's key. Switching providers is config-only (`lib/llm.ts`). |
| `SCRAPFLY_KEY` | scrapfly.io free tier (1,000 credits, no card) | Comments only. |

> The LLM key is independent of the Places key even if you pick a Google model — different products.

### 1.3 Content & tuning decisions
1. **Channel list** — the initial set of TikTok review channel URLs/handles to track. The
   pipeline does nothing until at least one channel is seeded. (`architecture.md` §11.2.)
2. **LLM model** — pick `LLM_MODEL="<provider>:<model-id>"` (provider ∈ `openai` | `google`).
   The call is provider-agnostic via `lib/llm.ts`, so this is config, not code. `architecture.md`
   suggested Gemini 3 Flash; OpenAI is equally supported — just set the env.
3. **Defaults are fine to start** — price buckets (`schemas.md` §4) and quality weights
   (`schemas.md` §3) ship as-is and are tuned against real data later. No action needed now.

### 1.4 Two design decisions I need a call on (details in §7)
- **D1 — schema amendment for resumability.** I recommend adding two nullable columns to
  `source_videos`: `extraction jsonb` (the raw per-video LLM output) and `geo jsonb` (the
  cached Places result). They make normalize/geocode independently resumable and let a spot's
  quality be recomputed from *all* its videos. This is an additive change to `schema.ts`.
  **Alternative:** keep `schema.ts` exactly as written and use an in-place running aggregate
  on `spots` (works, but loses clean re-aggregation and per-stage replay). → **need your OK.**
- **D2 — repo layout.** Bun-workspace monorepo with a shared `packages/db` (recommended, §3)
  vs. a flat single-package CLI that the web app type-imports from. → **need your preference.**

---

## 2. Tech stack

| Concern | Choice | Package |
|---|---|---|
| Runtime / lang | Bun + TypeScript | — |
| DB ORM + migrations | Drizzle + drizzle-kit | `drizzle-orm`, `drizzle-kit` |
| Postgres driver | postgres-js (direct conn) | `postgres` |
| Scrape metadata/captions | yt-dlp via subprocess | external binary |
| Comments | ScrapFly SDK | `scrapfly-sdk` |
| LLM extraction | Vercel AI SDK `generateObject` (provider-agnostic) | `ai`, `@ai-sdk/openai`, `@ai-sdk/google` |
| Schema validation | Zod (the `extractionSchema`) | `zod` |
| Geocoding | Places API (New) Text Search | `fetch` (no SDK needed) |
| CLI framework | `citty` (Bun-friendly subcommands) | `citty` |
| Logging | `consola` | `consola` |
| Bounded concurrency | `p-limit` | `p-limit` |

Notes:
- Bun auto-loads `.env`; no `dotenv` needed. Validate env at startup with a small Zod schema.
- yt-dlp is invoked with `Bun.spawn`; no JS wrapper lib (they lag the binary).
- Places API (New) is a plain POST — adding an SDK is overkill.

---

## 3. Repository structure (recommended: D2 = monorepo)

```
date_finder/
├─ package.json                 # private root, "workspaces": ["apps/*","packages/*"]
├─ tsconfig.base.json
├─ .env                         # CLI secrets (gitignored)
├─ .env.example                 # committed, documents every var from §1.2
├─ packages/
│  └─ db/                       # @date-finder/db — the data layer, shared
│     ├─ src/schema.ts          # ← move docs/schema.ts here (source of truth)
│     ├─ src/index.ts           # re-export schema + inferred types (Spot, NewSpot, …)
│     ├─ drizzle.config.ts      # entities.roles.provider:"supabase" (RLS emit)
│     └─ drizzle/               # generated migrations (committed)
└─ apps/
   ├─ cli/                      # @date-finder/cli — this plan
   │  └─ src/
   │     ├─ index.ts            # citty command tree / entrypoint
   │     ├─ env.ts              # Zod-validated env loader
   │     ├─ db.ts               # drizzle(postgres(DATABASE_URL)) client
   │     ├─ extraction.ts       # extractionSchema (Zod) + Extraction type
   │     ├─ scoring.ts          # price buckets + quality_score formula (deterministic)
   │     ├─ aggregate.ts        # multi-video → spot field merge
   │     ├─ commands/           # one file per stage (scrape, comments, normalize, …)
   │     └─ lib/                # ytdlp.ts, scrapfly.ts, places.ts, llm.ts, throttle.ts
   └─ web/                      # TanStack stub (separate task; type-imports @date-finder/db)
```

Why a shared `packages/db`: the frontend needs the inferred `Spot` types (`schema.ts`
already exports them and `architecture.md` says "share these with the frontend"), but it must
**not** import the postgres-js client. Splitting the *schema/types* (shared) from the *db
client* (`apps/cli/src/db.ts`, CLI-only) enforces that boundary at the package level — the web
app literally cannot pull in `postgres`. The doc's `./src/db/schema.ts` path is illustrative;
this is the same idea, relocated so two consumers can share it cleanly.

---

## 4. Database & migrations setup (do this first — every stage depends on it)

1. Move `docs/schema.ts` → `packages/db/src/schema.ts` unchanged (plus the §7/D1 columns if approved).
2. Add `drizzle.config.ts` per `schemas.md` §0, with `entities: { roles: { provider: "supabase" } }`
   so the `pgPolicy`/`enableRLS` declarations emit into the migration.
3. `bunx drizzle-kit generate` → review the SQL (confirm the three tables, the indexes from
   `schemas.md` §2, and the RLS block from §7 all appear) → `bunx drizzle-kit migrate`.
4. Wire `df migrate` / `df db:push` as CLI passthroughs so day-to-day runs don't need raw drizzle-kit.
5. **Verify the RLS boundary** right after migrating: with the anon key, `select` on `spots`
   succeeds and on `channels`/`source_videos` is denied. This is the one security-critical
   invariant of the whole system (`architecture.md` §7) — check it explicitly, don't assume.

---

## 5. CLI command surface

Staged commands (for cost control + debugging) plus one orchestrator. Each stage is a pure
function of DB state, gated by a column so re-runs are safe.

```
df channels add <url> [--handle @x] [--name "…"]   # seed/enable a channel
df channels list | deactivate <handle>

df scrape   [--channel @x] [--limit N]   # stages 1–2: enumerate + per-video metadata → source_videos
df comments [--limit N] [--min-views N]  # stage 3: ScrapFly top comments  (the metered step)
df normalize [--limit N] [--all]         # stage 4: LLM → source_videos.extraction (+ normalized_at)
df geocode  [--limit N]                  # stage 5: Places → source_videos.geo (place_id cache)
df upsert                                # stage 6: aggregate extractions → spots, link source_videos
df ingest   [--channel @x]               # run 1→6 end-to-end with sensible defaults

df migrate | db:push                     # drizzle passthroughs
```

Re-run gates (the idempotency contract):
- `scrape` skips `source_videos` whose `platform_video_id` already exists.
- `comments` selects rows with empty `top_comments` (and optional `--min-views` filter — comments are metered, so only score videos worth scoring per `architecture.md` §5).
- `normalize` selects `normalized_at IS NULL` (uses the partial index `source_videos_unnormalized_idx`); `--all` forces a full re-run after a prompt change.
- `geocode` selects normalized rows with a non-null `venueName` in `extraction` but null `geo`.
- `upsert` dedups on `google_place_id`; recomputes `video_count`, `quality_signals`, `quality_score` from **all** of a place's videos on every run.

---

## 6. Pipeline stages — implementation detail

### Stage 1–2 · `scrape` (yt-dlp)  → `source_videos`
- Enumerate: `yt-dlp --flat-playlist --dump-json <channelUrl>` → list of video ids/urls.
- Per **new** video: `yt-dlp --skip-download --dump-json <url>` → map fields:
  `description`→`caption`, `view_count`/`like_count`/`comment_count`/`repost_count`→counts,
  `timestamp`→`posted_at`, `thumbnail`→`thumbnail_url`, hashtags parsed from caption/`tags`.
- **Throttle**: `--sleep-interval 2 --max-sleep-interval 5`, strictly serial. TikTok blocks
  fast/uniform patterns and blocks stick (`architecture.md` §5). Run on your home Addis IP.
- Run `yt-dlp -U` before large batches; wrap subprocess errors per-video, continue on failure.
- Update `channels.last_scraped_at` when a channel finishes.

### Stage 3 · `comments` (ScrapFly) → `source_videos.top_comments`
- Only the **metered** stage. Pull ~20 top comments per video, sorted by likes, via the
  ScrapFly TikTok comment scrape; store as `[{text, likes, author}]` (matches `TopComment`).
- Budget: free 1,000 credits cover a v0 batch. Use `--min-views`/`--limit` to scope to videos
  worth quality-scoring. LamaTok / EnsembleData are fallbacks if credits run low.

### Stage 4 · `normalize` (LLM) → `source_videos.extraction`
- `generateObject({ model: getModel(), schema: extractionSchema, temperature: 0, prompt })`
  where `getModel()` (`lib/llm.ts`) resolves the provider from `LLM_MODEL`; prompt =
  `caption + topComments`. Schema is verbatim from `schemas.md` §5.
- Store the validated object in `source_videos.extraction`, set `normalized_at = now()`.
- `venueName === null` → mark normalized but it produces **no spot** (no geocode target;
  `schemas.md` §5 / `architecture.md` §5). Bounded concurrency via `p-limit` (~4).
- Re-runnable after prompt tuning via `--all` — no re-scrape, the inputs are already in the DB.

### Stage 5 · `geocode` (Places API New) → `source_videos.geo`
- `POST places:searchText` with `textQuery = "{venueName} {neighborhood} Addis Ababa"`,
  `X-Goog-FieldMask: places.id,places.location,places.formattedAddress,places.priceLevel`.
- Cache the result (`place_id, lat, lng, formatted_address, priceLevel`) in `source_videos.geo`.
- In-run de-dup: memoize by query string so several videos naming one venue cost one call.
- No match → leave `geo` null, log; that video simply won't contribute a spot this run.

### Stage 6 · `upsert` → `spots` (+ link `source_videos.spot_id`)
- Group geocoded videos by `place_id`. For each place, aggregate across **all** its videos
  (see §7 / `aggregate.ts`): dimensions, evidence, price, tags, summary, `video_count`.
- Compute `price_level` (`schemas.md` §4) and `quality_score` (`schemas.md` §3) deterministically
  in `scoring.ts` — the model returns dimension scores, the **CLI** owns the final number so it
  stays debuggable (`architecture.md` §5).
- Upsert on `google_place_id` (`onConflictDoUpdate`); set each contributing
  `source_videos.spot_id`; bump `updated_at`.

---

## 7. Open design decisions (need your call) + the aggregation gap

The docs fully specify *single-video* extraction and the *deterministic* scoring formula, but
leave one thing implicit: **how multiple videos about the same venue combine into one spot.**
A spot is deduped on `place_id`, several videos map to it, and `evidenceFactor` depends on
`video_count` — so aggregation is unavoidable. Two ways to support it:

- **D1 Option A (recommended): persist per-video `extraction` + `geo` on `source_videos`.**
  Adds two nullable jsonb columns. Spot fields are always recomputed from the full set of a
  place's videos → clean re-aggregation, every stage independently resumable, cheap replay
  after weight changes (no LLM re-call). Fully consistent with the "re-normalize without
  re-scrape" principle, just extended one column further.
- **D1 Option B: no schema change, running aggregate in place on `spots`.** Merge each new
  video into the stored spot incrementally. Works, but a weight/prompt change forces re-running
  the LLM over everything, and per-stage replay is lossy. Cheaper to start, costlier to tune.

Proposed v0 aggregation rules (tunable, live in `aggregate.ts`):
- **dimensions** → simple mean across videos (later: weight by mention counts).
- **evidence** → sum of `positiveMentions` / `negativeMentions` / `aestheticMentions`.
- **price** → lowest `price_min` and highest `price_max` seen; prefer `per_person` basis.
- **tags** → union, deduped. **summary** → from the highest-engagement video.
- **video_count** → count of linked videos → feeds `evidenceFactor`.

These give a working default so implementation isn't blocked; they're the first knobs to
revisit against real Addis data (`architecture.md` §11.3).

---

## 8. Cross-cutting concerns

- **Env validation** — `env.ts` parses every §1.2 var with Zod at startup; fail fast with a
  message naming the missing var.
- **Idempotency** — enforced by the unique constraints (`platform_video_id`, `google_place_id`)
  and the null-column gates in §5. No stage assumes a clean slate.
- **Failure isolation** — per-item try/catch in every stage; log and continue, leaving the gate
  column unset so the item is retried next run. No single bad video aborts a batch.
- **Rate discipline** — yt-dlp serial + throttled; ScrapFly scoped by `--min-views`; LLM/Places
  bounded by `p-limit`. Places memoized within a run.
- **Logging** — `consola` with per-stage start/finish counts (`scraped 42, skipped 8, failed 1`).
- **Secrets** — `.env` gitignored, `.env.example` committed. No write/geocode/scrape key ever
  reaches `apps/web`.

---

## 9. Build order (milestones)

1. **Scaffold** — `git init`, root workspace `package.json`, `tsconfig.base.json`, `.gitignore`,
   `.env.example`. Create `packages/db` and `apps/cli` packages.
2. **DB layer** — relocate `schema.ts` (+D1 columns if approved), `drizzle.config.ts`,
   `generate` → review → `migrate`. **Verify RLS** (§4.5). *Gate: migrations apply, RLS holds.*
3. **CLI skeleton** — `citty` command tree, `env.ts`, `db.ts`, `consola`. `df channels add/list`
   working against the DB. *Gate: can seed a channel.*
4. **`scrape`** — yt-dlp enumerate + metadata → `source_videos`. *Gate: real rows for one channel.*
5. **`comments`** — ScrapFly top comments. *Gate: `top_comments` populated for scoped videos.*
6. **`normalize`** — `generateObject` + `extractionSchema` → `extraction`. *Gate: valid extractions, nulls handled.*
7. **`geocode`** — Places Text Search → `geo`. *Gate: place_ids resolved.*
8. **`upsert` + `scoring` + `aggregate`** — produce `spots`. *Gate: deduped spots with sane scores.*
9. **`ingest`** orchestrator + a short README (env setup, run order, refresh cadence).

Each milestone is independently demoable because each stage persists to the DB.

---

## 10. Testing & verification

- **Unit (pure, no network)** — `scoring.ts` (formula + price buckets against `schemas.md`
  worked examples) and `aggregate.ts` (1-video and 3-video cases). These are the only logic-
  heavy, deterministic pieces; they get real tests.
- **Contract** — a couple of fixture `caption + comments` blobs asserted to parse against
  `extractionSchema` (guards prompt/schema drift).
- **Integration (manual, gated)** — run each stage against one real channel on a throwaway
  Supabase project; eyeball `source_videos` then `spots`. Network stages aren't unit-tested.
- **RLS check** — scripted anon-key assertion from §4.5, kept as a repeatable check.

---

## 11. Out of scope here (so it isn't half-built)
- TanStack frontend beyond the stub (separate task, design pending).
- Auth / `visits` table — v0 visited is `localStorage` (`schemas.md` §6, §8).
- whisper.cpp venue recovery, PostGIS, scheduled refresh, multi-city (`architecture.md` §10).

---

## 12. Immediate asks (unblockers)
1. Approve **D1** (add `extraction`+`geo` columns to `source_videos`? recommended yes).
2. Approve **D2** (monorepo with `packages/db`? recommended yes).
3. Provide the **channel list** and confirm the **Gemini model id**.
4. Stand up the **accounts/keys** in §1.2 (I can't create these); installing **yt-dlp** locally.

Once D1/D2 are settled I scaffold the workspace, land the DB layer + migrations, and build the
stages in the §9 order — each one demoable against your Supabase as it lands.
