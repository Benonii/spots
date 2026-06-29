/**
 * Multi-video → one spot aggregation (D1). When several videos resolve to the
 * same google_place_id, merge their per-video extractions into the fields a
 * spot row needs. v0 rules per docs/plans/cli-implementation-plan.md §7 — these
 * are the first knobs to tune against real data.
 *
 *   dimensions → mean across videos
 *   evidence   → sum of mention counts
 *   price      → lowest min / highest max; basis prefers per_person
 *   tags       → deduped union
 *   summary    → from the highest-engagement video
 *   neighborhood → from the highest-engagement video that named one
 */
import type { Extraction, GeoResult, QualitySignals } from "@spots/db";
import { priceLevel, qualityScore, type PriceBasis } from "@spots/db/scoring";

export type VideoForAgg = {
  extraction: Extraction;
  geo: GeoResult;
  engagement: number; // e.g. like_count, for summary/neighborhood tiebreak
};

export type AggregatedSpot = {
  qualitySignals: QualitySignals;
  qualityScore: number;
  priceMin: number | null;
  priceMax: number | null;
  priceBasis: PriceBasis;
  priceLevel: number | null;
  tags: string[];
  summary: string;
  neighborhood: string | null;
  videoCount: number;
};

const DIMENSION_KEYS = [
  "aesthetic",
  "vibe",
  "food",
  "value",
  "service",
] as const;

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Prefer per_person; fall back to the first non-unknown; else unknown. */
function pickBasis(bases: PriceBasis[]): PriceBasis {
  if (bases.includes("per_person")) return "per_person";
  return bases.find((b) => b !== "unknown") ?? "unknown";
}

export function aggregateSpot(videos: VideoForAgg[]): AggregatedSpot {
  if (videos.length === 0) {
    throw new Error("aggregateSpot called with no videos");
  }

  const dimensions = {} as QualitySignals["dimensions"];
  for (const key of DIMENSION_KEYS) {
    dimensions[key] = mean(videos.map((v) => v.extraction.dimensions[key]));
  }

  const qualitySignals: QualitySignals = {
    dimensions,
    evidence: {
      positiveMentions: sum(
        videos.map((v) => v.extraction.evidence.positiveMentions),
      ),
      negativeMentions: sum(
        videos.map((v) => v.extraction.evidence.negativeMentions),
      ),
      aestheticMentions: sum(
        videos.map((v) => v.extraction.evidence.aestheticMentions),
      ),
    },
  };

  const mins = videos
    .map((v) => v.extraction.price.min)
    .filter((x): x is number => x != null);
  const maxs = videos
    .map((v) => v.extraction.price.max)
    .filter((x): x is number => x != null);
  const priceMin = mins.length ? Math.min(...mins) : null;
  const priceMax = maxs.length ? Math.max(...maxs) : null;
  const priceBasis = pickBasis(videos.map((v) => v.extraction.price.basis));

  const tags = [...new Set(videos.flatMap((v) => v.extraction.tags))];

  const byEngagement = [...videos].sort((a, b) => b.engagement - a.engagement);
  const summary = byEngagement[0]!.extraction.summary;
  const neighborhood =
    byEngagement.find((v) => v.extraction.neighborhood)?.extraction
      .neighborhood ?? null;

  const videoCount = videos.length;

  return {
    qualitySignals,
    qualityScore: qualityScore(qualitySignals, videoCount),
    priceMin,
    priceMax,
    priceBasis,
    priceLevel: priceLevel(priceMin, priceMax, priceBasis),
    tags,
    summary,
    neighborhood,
    videoCount,
  };
}
