/**
 * Google Places API (New) — Text Search. Resolves a messy venue name to
 * { place_id, lat, lng, address, priceLevel }. Runs CLI-side only; the key
 * never ships to the browser. priceLevel here is Places' coarse fallback — the
 * authoritative price comes from the LLM extraction.
 */
import { getEnv } from "../env.ts";
import type { GeoResult } from "@date-finder/db";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK =
  "places.id,places.location,places.formattedAddress,places.priceLevel,places.displayName";

// Addis Ababa center, used to bias results toward the city (covers nearby towns
// like Bishoftu within the radius).
const ADDIS = { latitude: 9.0192, longitude: 38.7525 };

const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

type PlaceResult = {
  id?: string;
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  priceLevel?: string;
};

/** Text-search a venue; returns the top match or null if none. Throws on API error. */
export async function geocodeVenue(query: string): Promise<GeoResult | null> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getEnv().GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      regionCode: "ET",
      maxResultCount: 1,
      locationBias: { circle: { center: ADDIS, radius: 50000 } },
    }),
  });

  if (!res.ok) {
    throw new Error(`Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = (await res.json()) as { places?: PlaceResult[] };
  const place = data.places?.[0];
  if (!place?.id || !place.location) return null;

  return {
    placeId: place.id,
    lat: place.location.latitude,
    lng: place.location.longitude,
    formattedAddress: place.formattedAddress ?? null,
    priceLevel: place.priceLevel
      ? (PRICE_LEVEL_MAP[place.priceLevel] ?? null)
      : null,
  };
}
