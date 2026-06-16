/** Shape of a `spots` row as returned by supabase-js (snake_case columns). */
export type Dimensions = {
  aesthetic: number;
  vibe: number;
  food: number;
  value: number;
  service: number;
};

export type QualitySignals = {
  dimensions: Dimensions;
  evidence: {
    positiveMentions: number;
    negativeMentions: number;
    aestheticMentions: number;
  };
};

export type Spot = {
  id: string;
  google_place_id: string;
  name: string;
  neighborhood: string | null;
  address: string | null;
  lat: number;
  lng: number;
  price_min: number | null;
  price_max: number | null;
  price_currency: string;
  price_basis: "per_person" | "total" | "unknown";
  price_level: number | null;
  quality_score: number;
  quality_signals: QualitySignals;
  tags: string[];
  summary: string | null;
  video_count: number;
  cover_image_url: string | null;
  source_video_url: string | null;
  first_seen_at: string;
};

/**
 * A row of the `visits` table (our "Places we've been" log), persisted to the
 * DB. `dims` are our subjective 0..5 sliders; null = not yet rated. `userId` is
 * null for now (ours) — see schema.ts for the launch/auth plan.
 */
export type VisitedEntry = {
  id: string; // visits.id (server-assigned)
  placeId: string; // spots.google_place_id
  userId: string | null;
  name: string;
  visitedAt: string; // ISO date
  rating: number; // 0..5 (0 = unrated)
  notes: string;
  aesthetic: number | null;
  vibe: number | null;
  food: number | null;
  portions: number | null;
  service: number | null;
};

/** The editable subset of a visit — maps 1:1 to `visits` columns. */
export type VisitPatch = Partial<
  Pick<
    VisitedEntry,
    "rating" | "notes" | "aesthetic" | "vibe" | "food" | "portions" | "service"
  >
>;

/** Our subjective slider dimensions (note: "portions" replaces "value"). */
export const VISIT_DIMS = [
  ["aesthetic", "Aesthetic"],
  ["vibe", "Vibe"],
  ["food", "Food"],
  ["portions", "Portions"],
  ["service", "Service"],
] as const;
