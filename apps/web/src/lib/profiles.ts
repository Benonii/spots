import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile } from "./types";

type Row = Record<string, unknown>;

function rowToProfile(r: Row): Profile {
  return {
    id: String(r.id),
    displayName: (r.display_name as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
  };
}

/** Mirror the signed-in user's Google name + avatar into the public `profiles`
 * table so their reviews can show who wrote them. Best-effort; called on login. */
export async function upsertProfile(user: User): Promise<void> {
  const meta = user.user_metadata ?? {};
  const displayName =
    (meta.full_name as string) || (meta.name as string) || user.email || "Someone";
  const avatarUrl = (meta.avatar_url as string) || (meta.picture as string) || null;
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id: user.id, display_name: displayName, avatar_url: avatarUrl, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
  if (error) throw new Error(error.message);
}

/** Fetch profiles for a set of user ids (for joining onto community visits). */
export async function fetchProfiles(ids: string[]): Promise<Record<string, Profile>> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from("profiles").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  const out: Record<string, Profile> = {};
  for (const r of data ?? []) out[String(r.id)] = rowToProfile(r as Row);
  return out;
}
