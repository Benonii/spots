# spots

Recommendation engine for date spots around Addis Ababa, built from TikTok review
channels. An ingestion CLI mines the channels into a curated `spots` table; a web app
surfaces them. See `docs/architecture.md` for the full design and
`docs/plans/cli-implementation-plan.md` for the CLI build plan.

Bun-workspace monorepo:

- **`packages/db`** — Drizzle schema (source of truth), migrations, inferred types. Shared.
- **`apps/cli`** — `spots`, the ingestion pipeline and analytics reporting.
- **`apps/web`** — TanStack Router SPA: the live frontend (spot carousel, "Near me",
  saved spots, Google sign-in, feedback collector, usage analytics).

## Setup

1. `bun install`
2. `cp .env.example .env` and fill it in (Supabase, Google Places, LLM provider, ScrapFly).
   The LLM is provider-agnostic — set `LLM_MODEL="openai:..."` or `"google:..."` + `LLM_API_KEY`.
3. Install the scraper binary: `pipx install yt-dlp` (ffmpeg is already required/present).
4. Create the schema: `bun run db:generate` (already done for the initial schema) then
   `bun run db:migrate` against your Supabase `DATABASE_URL`.

## CLI

```bash
bun run spots --help                      # or: cd apps/cli && bun src/index.ts --help
bun run spots channels add <tiktok-url>   # seed a channel
bun run spots channels list
# ingestion pipeline (each stage idempotent, reads its work-list from the DB):
bun run spots scrape | comments | normalize | geocode | upsert | covers
bun run spots ingest                      # all stages end-to-end
bun run spots analytics --days 30         # DAU/MAU, stickiness, most-used features
```

Each stage is idempotent and reads its work-list from the DB, so runs are resumable and
re-playable (e.g. `spots normalize --all` after tuning the prompt — no re-scrape).

## Web app

TanStack Router SPA in `apps/web` (`bun run dev`), reading `spots` directly from Supabase
with the anon key (RLS keeps `channels`/`source_videos` private). Features:

- **Spot carousel** on `/` — the main "surprise me" discovery view, with road-distance
  estimates from the user's location (coordinates stay on-device, never sent to the server).
- **Near me** (`/near`) — spots sorted by distance; cover images deep-link back into the
  carousel via `?spot=<place_id>`.
- **Saved spots** — Google OAuth sign-in; "Places we've been" and "Want to go" lists are
  per-user, enforced with Supabase RLS.
- **Feedback collector** — bottom-right launcher (a single FAB with a popup on mobile)
  opening a modal for bug reports, feature ideas, and general notes → `feedback` table.
- **What's New** — Shiplog changelog widget.
- **First-party analytics** — anonymous usage events (`events` table) keyed by a persistent
  anon ID, so DAU/MAU/feature-usage cover every visitor; read back via `spots analytics`.

## Data model

`spots` is the curated output of the pipeline. The app also writes to two browser-facing,
insert-only (RLS) tables:

- **`feedback`** — user-submitted bug/feature/general notes.
- **`events`** — usage analytics (`name`, `props`, `anon_id`, optional `user_id`, `path`).
  Queries live in `packages/db/analytics.sql`.

## Status

**Ingestion pipeline complete and validated end-to-end** (`scrape → comments → normalize →
geocode → upsert → covers`), all stages writing to Supabase, RLS boundary verified with the
anon key (reads `spots`, denied on `channels`/`source_videos`). Deterministic
`scoring`/`aggregate` modules unit-tested. The **web frontend is live** — carousel, Near me,
saved spots, OAuth, feedback, and analytics are all shipped. Remaining CLI nicety: the
`ingest` orchestrator (run all stages in one command) is still a stub.

### Operational notes
- yt-dlp must be reachable: set `YT_DLP_BIN` in `.env` (e.g. `~/.local/bin/yt-dlp`) or add it to PATH.
- TikTok scraping needs `python-curl_cffi` installed (yt-dlp impersonation) or ~30% of fetches fail.
- LLM is provider-agnostic via `LLM_MODEL="provider:model-id"` (currently `openai:gpt-5-mini`).

```bash
bun test --cwd apps/cli   # scoring + aggregate unit tests
bun test --cwd apps/web   # maps-url parser + spot-edit diff/lock unit tests
```
