# @date-finder/web — placeholder

The TanStack Router + Vite SPA will be initialized here once the frontend design
is provided (see `docs/architecture.md` §3.3 / §6).

It will read **only** `spots`, via `@supabase/supabase-js` (anon key, RLS-enforced),
and type-import inferred types from `@date-finder/db` — never the postgres client.
