/**
 * Pure, side-effect-free spot-editing logic (no Supabase import), so it can be
 * unit-tested directly. curation.ts wraps these with the actual I/O.
 */
import { priceLevel } from "@spots/db/scoring";
import type { Dimensions, Spot } from "./types";

/** The admin-editable shape of a spot — maps onto the six curatable fields. */
export type SpotDraft = {
  name: string;
  description: string;
  mapUrl: string;
  tiktokUrl: string; // optional → spots.source_video_url (Watch button + clickable cover)
  lat: number | null;
  lng: number | null;
  neighborhood: string;
  address: string;
  tags: string[];
  priceMin: number | null;
  priceMax: number | null;
  priceBasis: "per_person" | "total" | "unknown";
  dimensions: Dimensions;
};

const sameTags = (a: string[], b: string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * Given an existing spot and an edited draft, return only the columns that
 * changed plus the set of curatable logical fields touched. That `changed` set
 * becomes `locked_fields`, so the next scrape won't revert them.
 */
export function diffSpot(
  spot: Spot,
  draft: SpotDraft,
): { patch: Record<string, unknown>; changed: Set<string> } {
  const changed = new Set<string>();
  const patch: Record<string, unknown> = {};

  const name = draft.name.trim();
  if (name && name !== spot.name) {
    patch.name = name;
    changed.add("name");
  }
  const desc = draft.description.trim() || null;
  if (desc !== (spot.summary ?? null)) {
    patch.summary = desc;
    changed.add("description");
  }
  if (draft.lat != null && draft.lng != null && (draft.lat !== spot.lat || draft.lng !== spot.lng)) {
    patch.lat = draft.lat;
    patch.lng = draft.lng;
    changed.add("location");
  }
  const nb = draft.neighborhood.trim() || null;
  if (nb !== (spot.neighborhood ?? null)) {
    patch.neighborhood = nb;
    changed.add("location");
  }
  const addr = draft.address.trim() || null;
  if (addr !== (spot.address ?? null)) {
    patch.address = addr;
    changed.add("location");
  }
  const mapUrl = draft.mapUrl.trim() || null;
  if (mapUrl !== (spot.map_url ?? null)) patch.map_url = mapUrl; // not scrape-owned; no lock needed
  const tiktok = draft.tiktokUrl.trim() || null;
  if (tiktok !== (spot.source_video_url ?? null)) {
    patch.source_video_url = tiktok;
    changed.add("video"); // lock so a re-scrape keeps the admin's link
  }
  if (!sameTags(draft.tags, spot.tags)) {
    patch.tags = draft.tags;
    changed.add("tags");
  }
  if (
    draft.priceMin !== spot.price_min ||
    draft.priceMax !== spot.price_max ||
    draft.priceBasis !== spot.price_basis
  ) {
    patch.price_min = draft.priceMin;
    patch.price_max = draft.priceMax;
    patch.price_basis = draft.priceBasis;
    patch.price_level = priceLevel(draft.priceMin, draft.priceMax, draft.priceBasis);
    changed.add("price");
  }
  return { patch, changed };
}
