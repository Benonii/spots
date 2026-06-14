# @date-finder/web

TanStack Router SPA — browse Addis date spots. Reads **only** the `spots` table via
`@supabase/supabase-js` with the publishable (anon) key, enforced by RLS. Ported from the
prototype in `design/`.

## Run

```bash
bun run dev       # vite dev server
bun run build     # typecheck + production build → dist/
bun run preview   # serve the production build
```

Env comes from the repo-root `.env` (Vite `envDir`): `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`. The secret key is never `VITE_`-prefixed, so it can't be bundled.

## Features
- Filter by area / price, sort (rating, price, name, recency), "surprise me" random pick.
- Spot card: cover, rating + per-dimension breakdown, price band, tags, Leaflet map.
- Visited log in `localStorage` (`addis-date-spots:visited`) with editable ratings + notes.
- Keyboard ← / → to page through spots.

## Notes
- Map is Leaflet + CARTO Voyager tiles; client-only.
- `cover_image_url` (TikTok thumbnail) renders over a deterministic gradient fallback, so a
  missing/blocked thumbnail still looks intentional.
