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
import type { Profile, Role, Spot } from "./types";
import { diffSpot, type SpotDraft } from "./spot-diff";

export { diffSpot } from "./spot-diff";
export type { SpotDraft } from "./spot-diff";

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

/**
 * Upload a spot's cover image; returns its permanent public URL. Each upload goes
 * to a UNIQUE path (never overwrites), so the storage policy can be INSERT-only —
 * a signed-in user can't replace or delete an existing cover, only add new objects.
 * A replaced cover just leaves the old object orphaned (cheap to garbage-collect).
 */
export async function uploadCover(placeId: string, file: File): Promise<string> {
  const ext =
    (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${safeKey(placeId)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error } = await supabase.storage.from(COVERS_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || "image/jpeg",
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from(COVERS_BUCKET).getPublicUrl(path).data.publicUrl;
}

/* ── spot create / edit / hide / delete ─────────────────────────────────── */

const EMPTY_EVIDENCE = { positiveMentions: 0, negativeMentions: 0, aestheticMentions: 0 };

/** A live preview of how this draft will score (same formula as the scraper). */
export function draftScore(d: Pick<SpotDraft, "dimensions">): number {
  return qualityScore({ dimensions: d.dimensions }, 0);
}

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
    source_video_url: draft.tiktokUrl.trim() || null,
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
 * Patch an existing spot with only what changed, recording touched fields in
 * `locked_fields` so the next scrape won't revert them.
 */
export async function updateSpot(
  spot: Spot,
  userId: string,
  draft: SpotDraft,
  coverFile: File | null,
): Promise<void> {
  const { patch, changed } = diffSpot(spot, draft);
  patch.updated_by = userId;
  patch.updated_at = new Date().toISOString();
  if (coverFile) {
    patch.cover_image_url = await uploadCover(spot.google_place_id, coverFile);
    changed.add("cover"); // lock it so the scrape can't revert the new cover
  }
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

/**
 * Permanently delete a spot by place id (super only). Suppresses the place so a
 * scraped spot can't resurrect on the next upsert, then removes the row —
 * atomically, server-side, via the super-gated purge_spot() function.
 */
export async function purgeSpot(googlePlaceId: string): Promise<void> {
  const { error } = await supabase.rpc("purge_spot", { place_id: googlePlaceId });
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

/** A profile plus the email behind it (admins only, via the search_profiles RPC). */
export type ProfileMatch = Profile & { email: string | null };

/** Search signed-in people by display name OR email (to promote them). */
export async function searchProfiles(query: string): Promise<ProfileMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase.rpc("search_profiles", { query: q });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...toProfile(r),
    email: (r.email as string | null) ?? null,
  }));
}

/** Change a user's role. Server-enforced super-only via the set_role() function. */
export async function setRole(targetId: string, role: Role): Promise<void> {
  const { error } = await supabase.rpc("set_role", { target_id: targetId, new_role: role });
  if (error) throw new Error(error.message);
}
