# date-finder

Recommendation engine for date spots around Addis Ababa, built from TikTok review
channels. See `docs/architecture.md` for the full design and
`docs/plans/cli-implementation-plan.md` for the CLI build plan.

Bun-workspace monorepo:

- **`packages/db`** — Drizzle schema (source of truth), migrations, inferred types. Shared.
- **`apps/cli`** — `df`, the ingestion pipeline (this is what's built so far).
- **`apps/web`** — TanStack Router SPA. Placeholder until the frontend design lands.

## Setup

1. `bun install`
2. `cp .env.example .env` and fill it in (Supabase, Google Places, LLM provider, ScrapFly).
   The LLM is provider-agnostic — set `LLM_MODEL="openai:..."` or `"google:..."` + `LLM_API_KEY`.
3. Install the scraper binary: `pipx install yt-dlp` (ffmpeg is already required/present).
4. Create the schema: `bun run db:generate` (already done for the initial schema) then
   `bun run db:migrate` against your Supabase `DATABASE_URL`.

## CLI

```bash
bun run df --help                      # or: cd apps/cli && bun src/index.ts --help
bun run df channels add <tiktok-url>   # seed a channel
bun run df channels list
# pipeline (stages land per docs/plans milestones 4–9):
bun run df scrape | comments | normalize | geocode | upsert
bun run df ingest                      # all stages end-to-end
```

Each stage is idempotent and reads its work-list from the DB, so runs are resumable and
re-playable (e.g. `df normalize --all` after tuning the prompt — no re-scrape).

## Status

**Ingestion pipeline complete and validated end-to-end** (`scrape → comments → normalize →
geocode → upsert`), all six stages writing to Supabase, RLS boundary verified with the anon
key (reads `spots`, denied on `channels`/`source_videos`). Deterministic `scoring`/`aggregate`
modules unit-tested. Remaining CLI nicety: the `ingest` orchestrator (run all stages in one
command) is still a stub. Next major phase: the TanStack frontend reading `spots`.

### Operational notes
- yt-dlp must be reachable: set `YT_DLP_BIN` in `.env` (e.g. `~/.local/bin/yt-dlp`) or add it to PATH.
- TikTok scraping needs `python-curl_cffi` installed (yt-dlp impersonation) or ~30% of fetches fail.
- LLM is provider-agnostic via `LLM_MODEL="provider:model-id"` (currently `openai:gpt-5-mini`).

```bash
bun test --cwd apps/cli   # scoring + aggregate unit tests
```
