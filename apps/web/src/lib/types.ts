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

/** localStorage visited entry — schemas.md §6. */
export type VisitedEntry = {
  placeId: string; // spots.google_place_id
  name: string;
  visitedAt: string; // ISO date
  rating?: number; // 1..5
  notes?: string;
};
