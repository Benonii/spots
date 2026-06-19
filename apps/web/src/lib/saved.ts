import { supabase } from "./supabase";

/**
 * The private "want to go" list — bookmarked spots, owner-scoped by RLS.
 * user_id is stamped server-side from auth.uid(); a unique (user, place) index
 * makes saves idempotent. Callers run while signed in.
 */

/** Place ids the user has saved, newest first. */
export async function fetchSaved(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("saved_spots")
    .select("google_place_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => String(r.google_place_id));
}

export async function addSaved(placeId: string): Promise<void> {
  const { error } = await supabase
    .from("saved_spots")
    .insert({ google_place_id: placeId });
  // 23505 = unique violation → already saved, treat as success
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function removeSaved(placeId: string): Promise<void> {
  const { error } = await supabase
    .from("saved_spots")
    .delete()
    .eq("google_place_id", placeId); // RLS scopes the delete to the owner
  if (error) throw new Error(error.message);
}
