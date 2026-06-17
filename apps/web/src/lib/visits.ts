import { supabase, ensureSession } from "./supabase";
import type { VisitedEntry, VisitPatch } from "./types";

/**
 * CRUD for the `visits` table — the "Places we've been" log, persisted to
 * Supabase and scoped to the signed-in (anonymous) user by RLS. Every read and
 * write calls ensureSession() first: it's cheap once a session exists, and it
 * self-heals the first-write-after-enabling case by retrying the sign-in. The
 * row's user_id is stamped server-side from auth.uid() (column default), so the
 * client never sends it. See packages/db/src/schema.ts.
 */

const num = (v: unknown): number | null => (v == null ? null : Number(v));

type Row = Record<string, unknown>;

function rowToEntry(r: Row): VisitedEntry {
  return {
    id: String(r.id),
    placeId: String(r.google_place_id),
    userId: (r.user_id as string | null) ?? null,
    name: String(r.name),
    visitedAt: String(r.visited_at),
    rating: num(r.rating) ?? 0,
    notes: (r.notes as string | null) ?? "",
    aesthetic: num(r.aesthetic),
    vibe: num(r.vibe),
    food: num(r.food),
    portions: num(r.portions),
    service: num(r.service),
  };
}

export async function fetchVisits(): Promise<VisitedEntry[]> {
  await ensureSession();
  const { data, error } = await supabase
    .from("visits")
    .select("*")
    .order("visited_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToEntry);
}

export async function createVisit(input: {
  placeId: string;
  name: string;
  visitedAt: string;
  rating?: number;
  notes?: string;
}): Promise<VisitedEntry> {
  await ensureSession();
  const { data, error } = await supabase
    .from("visits")
    .insert({
      google_place_id: input.placeId,
      name: input.name,
      visited_at: input.visitedAt,
      rating: input.rating ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToEntry(data as Row);
}

export async function updateVisit(id: string, patch: VisitPatch): Promise<void> {
  await ensureSession();
  // VisitPatch keys are identical to the column names, so it maps 1:1.
  const { error } = await supabase
    .from("visits")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteVisit(id: string): Promise<void> {
  await ensureSession();
  const { error } = await supabase.from("visits").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteVisitsByPlace(placeId: string): Promise<void> {
  await ensureSession();
  const { error } = await supabase
    .from("visits")
    .delete()
    .eq("google_place_id", placeId);
  if (error) throw new Error(error.message);
}

/**
 * One-time best-effort import of any pre-existing localStorage log into the DB,
 * so we don't lose entries logged before persistence landed. Guarded by a flag
 * so it runs at most once per browser.
 */
const LEGACY_KEY = "addis-date-spots:visited";
const MIGRATED_FLAG = "addis-date-spots:visited:migrated";

export async function migrateLegacyVisits(
  existing: VisitedEntry[],
): Promise<VisitedEntry[]> {
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return [];
    const raw = localStorage.getItem(LEGACY_KEY);
    const legacy = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
    const have = new Set(existing.map((e) => e.placeId));
    const created: VisitedEntry[] = [];
    for (const l of legacy) {
      const placeId = l.placeId as string | undefined;
      if (!placeId || have.has(placeId)) continue;
      const entry = await createVisit({
        placeId,
        name: (l.name as string) ?? placeId,
        visitedAt: (l.visitedAt as string) ?? new Date().toISOString().slice(0, 10),
        rating: (l.rating as number) ?? undefined,
        notes: (l.notes as string) ?? undefined,
      });
      created.push(entry);
      have.add(placeId);
    }
    localStorage.setItem(MIGRATED_FLAG, "1");
    return created;
  } catch {
    return []; // never block app load on a migration hiccup
  }
}
