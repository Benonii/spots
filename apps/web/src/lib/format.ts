import type { Spot } from "./types";

export const ETB = (n: number): string => n.toLocaleString("en-US");

export const PRICE_LABELS: Record<number, string> = { 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };
export const PRICE_RANGE_TEXT: Record<number, string> = {
  1: "under 300",
  2: "300–700",
  3: "700–1,500",
  4: "over 1,500",
};

// Deterministic gradient placeholders, used when a spot has no cover image (or
// as a fallback layer behind a TikTok thumbnail that fails to load).
const COVERS = [
  "linear-gradient(160deg, #9FB68F 0%, #7E9579 100%)",
  "linear-gradient(160deg, #ECC079 0%, #E6A94F 100%)",
  "linear-gradient(160deg, #EA9560 0%, #E37B33 100%)",
  "linear-gradient(160deg, #A7BE9C 0%, #82996F 100%)",
  "linear-gradient(160deg, #E9B97E 0%, #D9924B 100%)",
  "linear-gradient(160deg, #B9AC90 0%, #968870 100%)",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** CSS `background-image` value: thumbnail over a deterministic gradient fallback. */
export function coverImage(spot: Spot): string {
  const grad = COVERS[hash(spot.google_place_id) % COVERS.length]!;
  return spot.cover_image_url ? `url("${spot.cover_image_url}"), ${grad}` : grad;
}

/** Google Maps deep link to the spot's exact place (by place_id). */
export function mapsUrl(spot: Spot): string {
  const q = encodeURIComponent(spot.name);
  return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${spot.google_place_id}`;
}
