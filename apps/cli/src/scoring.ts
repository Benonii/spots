/**
 * Deterministic scoring + price bucketing — owned by the CLI so the sortable
 * numbers stay debuggable (docs/architecture.md §5). Formulas from docs/schemas.md
 * §3 (quality) and §4 (price). Pure functions, unit-tested.
 */
import type { QualitySignals } from "@date-finder/db";

export const QUALITY_WEIGHTS = {
  aesthetic: 1.0,
  vibe: 1.0,
  food: 1.0,
  value: 1.2,
  service: 0.8,
} as const;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * quality_score, 0..100.
 *   base           = Σ(wᵢ·dᵢ) / Σ(wᵢ)              (0..5, over dimensions present)
 *   evidenceFactor = 0.85 + 0.05·min(videoCount,3) (0.90 @1 video → 1.00 @3+)
 *   score          = clamp(round(base·20·evidenceFactor), 0, 100)
 */
export function qualityScore(
  signals: QualitySignals,
  videoCount: number,
): number {
  const dims = signals.dimensions;
  let weightSum = 0;
  let weighted = 0;
  for (const key of Object.keys(QUALITY_WEIGHTS) as (keyof typeof QUALITY_WEIGHTS)[]) {
    const d = dims[key];
    if (d == null) continue; // tolerate partial dimension sets
    const w = QUALITY_WEIGHTS[key];
    weighted += w * d;
    weightSum += w;
  }
  const base = weightSum === 0 ? 0 : weighted / weightSum;
  const evidenceFactor = 0.85 + 0.05 * Math.min(videoCount, 3);
  return clamp(Math.round(base * 20 * evidenceFactor), 0, 100);
}

export type PriceBasis = "per_person" | "total" | "unknown";

/**
 * Derive price_level (1..4) per docs/schemas.md §4, or null if no price.
 *   value      = midpoint of a stated range, else min, else max
 *   perPerson  = value/2 when basis === 'total' (date = 2 people heuristic)
 *   buckets    = <300:1  300–700:2  700–1500:3  >1500:4
 */
export function priceLevel(
  min: number | null,
  max: number | null,
  basis: PriceBasis,
): number | null {
  const value =
    min != null && max != null ? (min + max) / 2 : (min ?? max);
  if (value == null) return null;

  const perPerson = basis === "total" ? value / 2 : value;
  if (perPerson < 300) return 1;
  if (perPerson < 700) return 2;
  if (perPerson < 1500) return 3;
  return 4;
}
