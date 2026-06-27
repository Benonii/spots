/**
 * Admin curation — everything that writes to the spots/profiles tables on behalf
 * of an admin. The database is the real gate: RLS only lets an admin insert a
 * manual spot they own, update their own (super: any), and hard-delete only their
 * own manual spots; "removing" a scraped spot is a hide (tombstone). Scores are
 * computed with the SAME deterministic formula the scraper uses (@spots/db/scoring)
 * so manual and scraped spots rank on one scale. See packages/db/src/schema.ts.
 */
import { supabase } from "./supabase";
import { qualityScore, priceLevel } from "@spots/db/scoring";
import type { Dimensions, Profile, Role, Spot } from "./types";

const COVERS_BUCKET = "spot-covers";

/* ── roles ──────────────────────────────────────────────────────────────── */

/** The signed-in user's curation role (defaults to 'user' on any miss). */
export async function fetchMyRole(userId: string): Promise<Role> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    if (import.meta.env.DEV) console.warn("role fetch failed:", error);
    return "user";
  }
  const r = data?.role as Role | undefined;
  return r === "admin" || r === "super" ? r : "user";
}

/* ── covers (Supabase Storage) ──────────────────────────────────────────── */

const safeKey = (placeId: string) => placeId.replace(/[^a-z0-9]/gi, "_");

/** Upload (or replace) a spot's cover image; returns its permanent public URL. */
export async function uploadCover(placeId: string, file: File): Promise<string> {
  const ext =
    (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${safeKey(placeId)}.${ext}`;
  const { error } = await supabase.storage.from(COVERS_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || "image/jpeg",
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from(COVERS_BUCKET).getPublicUrl(path).data.publicUrl;
}

/* ── spot create / edit / hide / delete ─────────────────────────────────── */

/** The admin-editable shape of a spot — maps onto the six curatable fields. */
export type SpotDraft = {
  name: string;
  description: string;
  mapUrl: string;
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

const EMPTY_EVIDENCE = { positiveMentions: 0, negativeMentions: 0, aestheticMentions: 0 };

/** A live preview of how this draft will score (same formula as the scraper). */
export function draftScore(d: Pick<SpotDraft, "dimensions">): number {
  return qualityScore({ dimensions: d.dimensions }, 0);
}

const sameTags = (a: string[], b: string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/** Create a hand-curated spot owned by the admin. A cover image is required. */
export async function createSpot(
  userId: string,
  draft: SpotDraft,
  coverFile: File,
): Promise<Spot> {
  if (draft.lat == null || draft.lng == null) throw new Error("A location is required.");
  const placeId = `manual:${crypto.randomUUID()}`;
  let coverUrl: string;
  try {
    coverUrl = await uploadCover(placeId, coverFile);
  } catch (e) {
    throw new Error(`Cover upload failed — ${e instanceof Error ? e.message : String(e)}`);
  }
  const row = {
    google_place_id: placeId,
    name: draft.name.trim(),
    neighborhood: draft.neighborhood.trim() || null,
    address: draft.address.trim() || null,
    lat: draft.lat,
    lng: draft.lng,
    price_min: draft.priceMin,
    price_max: draft.priceMax,
    price_currency: "ETB",
    price_basis: draft.priceBasis,
    price_level: priceLevel(draft.priceMin, draft.priceMax, draft.priceBasis),
    quality_score: draftScore(draft),
    quality_signals: { dimensions: draft.dimensions, evidence: EMPTY_EVIDENCE },
    tags: draft.tags,
    summary: draft.description.trim() || null,
    video_count: 0,
    cover_image_url: coverUrl,
    map_url: draft.mapUrl.trim() || null,
    source: "manual",
    owner_id: userId,
    created_by: userId,
  };
  const { data, error } = await supabase.from("spots").insert(row).select("*").single();
  if (error) throw new Error(`Saving the spot failed — ${error.message}`);
  return data as Spot;
}

/**
 * Patch an existing spot with only what changed, and record which curatable
 * fields were touched in `locked_fields` so the next scrape won't revert them.
 */
export async function updateSpot(
  spot: Spot,
  userId: string,
  draft: SpotDraft,
  coverFile: File | null,
): Promise<void> {
  const changed = new Set<string>();
  const patch: Record<string, unknown> = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

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
  if (coverFile) patch.cover_image_url = await uploadCover(spot.google_place_id, coverFile);

  patch.locked_fields = [...new Set([...(spot.locked_fields ?? []), ...changed])];

  const { error } = await supabase.from("spots").update(patch).eq("id", spot.id);
  if (error) throw new Error(error.message);
}

/** Hide (tombstone) or un-hide a spot. The scrape-proof way to remove a scraped spot. */
export async function setSpotHidden(spotId: string, hidden: boolean): Promise<void> {
  const { error } = await supabase
    .from("spots")
    .update({ hidden, updated_at: new Date().toISOString() })
    .eq("id", spotId);
  if (error) throw new Error(error.message);
}

/** Hard-delete a spot. RLS only permits this for manual spots you may remove. */
export async function deleteSpot(spotId: string): Promise<void> {
  const { error } = await supabase.from("spots").delete().eq("id", spotId);
  if (error) throw new Error(error.message);
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/** Every spot incl. hidden ones — admins see all via the "admins read all" policy. */
export async function fetchSpotsForAdmin(): Promise<Spot[]> {
  const { data, error } = await supabase
    .from("spots")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r): Spot => ({
    ...(r as Spot),
    lat: num(r.lat),
    lng: num(r.lng),
    price_min: numOrNull(r.price_min),
    price_max: numOrNull(r.price_max),
    price_level: numOrNull(r.price_level),
    quality_score: num(r.quality_score),
    video_count: num(r.video_count),
    tags: r.tags ?? [],
  }));
}

/* ── admin management (super only) ──────────────────────────────────────── */

const toProfile = (r: Record<string, unknown>): Profile => ({
  id: String(r.id),
  displayName: (r.display_name as string | null) ?? null,
  avatarUrl: (r.avatar_url as string | null) ?? null,
  role: (r.role as Role) ?? "user",
});

/** Current admins + supers, supers first. */
export async function listAdmins(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, role")
    .in("role", ["admin", "super"])
    .order("role", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toProfile(r as Record<string, unknown>));
}

/** Search signed-in people by display name (to promote them). */
export async function searchProfiles(query: string): Promise<Profile[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, role")
    .ilike("display_name", `%${q}%`)
    .limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toProfile(r as Record<string, unknown>));
}

/** Change a user's role. Server-enforced super-only via the set_role() function. */
export async function setRole(targetId: string, role: Role): Promise<void> {
  const { error } = await supabase.rpc("set_role", { target_id: targetId, new_role: role });
  if (error) throw new Error(error.message);
}
