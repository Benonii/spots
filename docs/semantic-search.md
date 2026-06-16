# Semantic search — production plan (deferred)

> Status: **not built.** Deferred until the app is shared with other people. The
> shipped search today is fuzzy keyword search (Fuse.js, client-side) plus tag-based
> category chips — see `apps/web`. This doc is the plan for upgrading to real
> semantic search when it's worth it.

## Why defer

A client-side embedding model (transformers.js + MiniLM) was rejected: a ~25MB
model download per visitor is fine for a local toy but wrong for a shared/prod app.
Production semantic search belongs **server-side**, with a thin client.

## The approach: pgvector + Supabase Edge Functions (`gte-small`)

Keep embeddings and search inside the existing Supabase — no external service, no
model in the browser, free on the Supabase free tier.

- Supabase runs the **`gte-small`** embedding model **natively in Edge Functions**
  (no external API, no key). It's ~10× cheaper than OpenAI embeddings beyond the
  free tier, and quality is on par: **MTEB 61.36 vs OpenAI text-embedding-3-small
  62.26**, at 384 dims (faster searches).
- Query and document embeddings must come from the **same model** (gte-small both
  sides), or the vectors aren't comparable.

### Data flow
1. **Store** — enable `pgvector`; add `embedding vector(384)` to `spots`. Embed each
   spot's `name + summary + tags` once and store it. Use Supabase's
   [automatic-embeddings](https://supabase.com/docs/guides/ai/automatic-embeddings)
   pattern (DB trigger + queue + edge function) so embeddings stay in sync as the
   CLI's `upsert` writes spots — no manual backfill drift.
2. **Query** — browser sends the search text to a small Edge Function → it embeds
   the query with gte-small → runs a `pgvector` cosine match in Postgres → returns
   ranked spots. (Supabase [semantic-search example](https://supabase.com/docs/guides/functions/examples/semantic-search).)
3. **Client** — a search box that calls the edge function. No model, no big download.

### Quality lever: hybrid search
Start with pure vector. Upgrade to [**hybrid search**](https://supabase.com/docs/guides/ai/hybrid-search)
(Postgres full-text + vector, fused by reciprocal rank) — the production gold
standard. Handles exact terms ("Tomoca") *and* concepts ("habesha", "romantic
rooftop") in one query.

## What it adds to the stack
- `pgvector` extension + `spots.embedding vector(384)` column (Drizzle: `vector` type).
- Embedding generation wired into the pipeline (automatic-embeddings trigger).
- One **Supabase Edge Function** for query-embed + match. This is the only
  architectural deviation from the "static SPA reads Supabase directly" decision —
  it's serverless/managed (not a server we run), and scoped to this feature.
- A `match_spots(query_embedding, match_count, threshold)` SQL function (RPC).
- Frontend: swap/augment the Fuse.js box to call the edge function.

## Cost
Free on Supabase's free tier — Edge Functions, built-in `gte-small`, and pgvector
are all included. No external API, no per-query charge.

## Effort
~1 day. Supabase has copy-paste guides for each piece (vector columns, generate
embeddings, semantic + hybrid search).

## Migration note
When built, gte-small is the v1 model. If higher relevance is ever needed, switch
both sides to OpenAI `text-embedding-3-small` (1536 dims) and re-embed all spots —
negligible cost, but a re-embed of the whole table.

Sources: [AI inference in Edge Functions](https://supabase.com/blog/ai-inference-now-available-in-supabase-edge-functions) ·
[pgvector](https://supabase.com/docs/guides/database/extensions/pgvector) ·
[Automatic embeddings](https://supabase.com/docs/guides/ai/automatic-embeddings) ·
[Hybrid search](https://supabase.com/docs/guides/ai/hybrid-search)
