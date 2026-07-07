import { supabase } from "./supabase";

/**
 * Spot Matches — opt-in, spot-anchored, mutual-only people matching.
 *
 * The security boundaries live in Postgres (migration 0016), not here:
 *  - want-to-go lists never leave the DB; matches_for_spot()/my_matches() return
 *    only overlap counts.
 *  - a peer's contact surfaces only through my_matches() (a mutual match).
 *  - likes are outgoing-read-only, so this module cannot see who liked the user.
 * All calls run while signed in; user_id / from_user / blocker are stamped
 * server-side from auth.uid(), so we never send them.
 */

export type ContactType = "email" | "telegram" | "instagram";

export type OptIn = {
  contactType: ContactType;
  contactValue: string;
  active: boolean;
};

/** A candidate surfaced under a saved spot ("wants to go here too"). */
export type SpotMatch = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  overlapCount: number;
  liked: boolean;
};

/** A confirmed mutual match, with the peer's chosen contact revealed. */
export type Match = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  contactType: ContactType;
  contactValue: string;
  overlapCount: number;
  matchedAt: string;
};

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v == null ? null : String(v));

/** The signed-in user's own opt-in row, or null if they haven't opted in. */
export async function fetchOptIn(userId: string): Promise<OptIn | null> {
  const { data, error } = await supabase
    .from("dating_opt_in")
    .select("contact_type, contact_value, active")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    contactType: data.contact_type as ContactType,
    contactValue: String(data.contact_value),
    active: Boolean(data.active),
  };
}

/** Opt in or update the contact channel. user_id is sent explicitly (not left
 * to the DB default) because upsert's onConflict target needs it. */
export async function saveOptIn(optIn: OptIn): Promise<void> {
  const { error } = await supabase.from("dating_opt_in").upsert(
    {
      user_id: (await requireUid()),
      contact_type: optIn.contactType,
      contact_value: optIn.contactValue,
      active: optIn.active,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

/** Leave the feature entirely. One atomic DEFINER RPC: removes the opt-in row,
 * likes in BOTH directions (RLS blocks the client from deleting incoming ones,
 * and stale incoming likes would otherwise mint surprise matches on a later
 * re-opt-in), and the user's own blocks. */
export async function leaveDating(): Promise<void> {
  const { error } = await supabase.rpc("leave_dating");
  if (error) throw new Error(error.message);
}

/** Opted-in others who also saved this spot, ranked by want-to-go overlap. */
export async function matchesForSpot(placeId: string): Promise<SpotMatch[]> {
  const { data, error } = await supabase.rpc("matches_for_spot", { place_id: placeId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Row) => ({
    userId: String(r.user_id),
    displayName: str(r.display_name),
    avatarUrl: str(r.avatar_url),
    overlapCount: Number(r.overlap_count ?? 0),
    liked: Boolean(r.liked),
  }));
}

/** Confirmed mutual matches, newest first, with revealed contact. */
export async function fetchMatches(): Promise<Match[]> {
  const { data, error } = await supabase.rpc("my_matches");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Row) => ({
    userId: String(r.user_id),
    displayName: str(r.display_name),
    avatarUrl: str(r.avatar_url),
    contactType: r.contact_type as ContactType,
    contactValue: String(r.contact_value),
    overlapCount: Number(r.overlap_count ?? 0),
    matchedAt: String(r.matched_at),
  }));
}

/** Like someone. Idempotent (unique pair); mutual likes become a match. */
export async function like(toUser: string): Promise<void> {
  const { error } = await supabase.from("likes").insert({ to_user: toUser });
  if (error && error.code !== "23505") throw new Error(error.message);
}

/** Withdraw a like. */
export async function unlike(toUser: string): Promise<void> {
  const { error } = await supabase
    .from("likes")
    .delete()
    .eq("to_user", toUser); // RLS scopes from_user to the caller
  if (error) throw new Error(error.message);
}

/** Block someone: mutual invisibility across both match surfaces. */
export async function block(blocked: string): Promise<void> {
  const { error } = await supabase.from("blocks").insert({ blocked });
  if (error && error.code !== "23505") throw new Error(error.message);
}

async function requireUid(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error("Not signed in");
  return id;
}
