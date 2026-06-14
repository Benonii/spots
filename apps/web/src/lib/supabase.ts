import { createClient } from "@supabase/supabase-js";
import type { QualitySignals, Spot } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (set them in the repo-root .env).",
  );
}

const supabase = createClient(url, key);

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
 */
export async function fetchSpots(): Promise<Spot[]> {
  const { data, error } = await supabase.from("spots").select("*");
  if (error) throw new Error(error.message);

  return (data ?? []).map(
    (r): Spot => ({
      ...(r as Spot),
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
