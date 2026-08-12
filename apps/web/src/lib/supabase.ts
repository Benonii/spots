import { createClient } from "@supabase/supabase-js";
import type { QualitySignals, Spot } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (set them in the repo-root .env).",
  );
}

export const supabase = createClient(url, key);

/**
 * Auth via Google OAuth. Owner-scoped data (the "Places we've been" log, and
 * later saved spots) is gated behind a real Google identity so it's durable and
 * follows the user across devices. supabase-js persists + auto-refreshes the
 * session in localStorage and completes the OAuth redirect on return.
 */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw new Error(error.message); // redirects away on success
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

const EMPTY_SIGNALS: QualitySignals = {
  dimensions: { aesthetic: 0, vibe: 0, food: 0, value: 0, service: 0 },
  evidence: { positiveMentions: 0, negativeMentions: 0, aestheticMentions: 0 },
};

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * Fetch all spots in one query (a few hundred rows; filter/sort happens
 * client-side per architecture.md §6). PostgREST may serialize `numeric` as
 * strings, so price/score fields are coerced to numbers here.
 *
 * First call may be served by the inline preload in index.html, which starts
 * the same request during HTML parse (in parallel with the JS bundle) and
 * parks the promise on `window.__spotsPreload`. Consumed at most once; any
 * preload failure falls back to a normal client query.
 */
export async function fetchSpots(): Promise<Spot[]> {
  const preload = (window as { __spotsPreload?: Promise<unknown> }).__spotsPreload;
  if (preload) {
    delete (window as { __spotsPreload?: Promise<unknown> }).__spotsPreload;
    try {
      const rows = await preload;
      if (Array.isArray(rows)) return mapSpots(rows);
    } catch {
      /* fall through to the client query */
    }
  }
  const { data, error } = await supabase.from("spots").select("*");
  if (error) throw new Error(error.message);
  return mapSpots(data ?? []);
}

/**
 * The single spot index.html fetched for the first paint, or null if that
 * request failed / overshot the offset ceiling / was skipped (signed-in users).
 * Resolves ~1s before the full catalog, so the deck can paint one card while
 * the rest is still in flight. Consumed at most once.
 */
let firstSpot: Promise<Spot | null> | null = null;

export function fetchFirstSpot(): Promise<Spot | null> {
  // Memoised, not just consumed-once: every caller must see the *same* spot.
  // Handing null to a second caller (a remount, say) would make it re-roll onto
  // a different card and strand the cover already preloaded for this one.
  if (!firstSpot) {
    const pending = (window as { __spotsFirst?: Promise<unknown> }).__spotsFirst;
    delete (window as { __spotsFirst?: Promise<unknown> }).__spotsFirst;
    firstSpot = Promise.resolve(pending ?? null)
      .then((row) => (row ? mapSpots([row])[0] ?? null : null))
      .catch(() => null); // the catalog query is the source of truth regardless
  }
  return firstSpot;
}

function mapSpots(rows: unknown[]): Spot[] {
  return (rows as Spot[]).map(
    (r): Spot => ({
      ...r,
      lat: num(r.lat),
      lng: num(r.lng),
      price_min: numOrNull(r.price_min),
      price_max: numOrNull(r.price_max),
      price_level: numOrNull(r.price_level),
      quality_score: num(r.quality_score),
      video_count: num(r.video_count),
      tags: r.tags ?? [],
      quality_signals: r.quality_signals ?? EMPTY_SIGNALS,
    }),
  );
}
