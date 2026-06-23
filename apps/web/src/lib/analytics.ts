import { supabase } from "./supabase";

/**
 * First-party product analytics. Every event is written to the `events` table
 * (insert-only RLS), tagged with a stable per-device `anon_id` so DAU/MAU spans
 * signed-in *and* anonymous visitors. `user_id` is stamped server-side from the
 * JWT when signed in — we never send it.
 *
 * Tracking is strictly fire-and-forget: a failed/slow insert must never delay a
 * click or surface an error, so every call swallows its own failures.
 */

const AID_KEY = "spots:aid";

let memoryAnonId: string | undefined;

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  // last-resort id for very old/locked-down browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Stable id for this device; persisted in localStorage, falls back to memory. */
function anonId(): string {
  try {
    let id = localStorage.getItem(AID_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(AID_KEY, id);
    }
    return id;
  } catch {
    // private mode / storage blocked — keep one id for the page session
    return (memoryAnonId ??= uuid());
  }
}

/** Record a product event. Never throws; safe to call without awaiting. */
export async function track(
  name: string,
  props?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("events").insert({
      name,
      props: props ?? null,
      anon_id: anonId(),
      path: typeof window !== "undefined" ? window.location.pathname : null,
    });
  } catch {
    /* analytics must never disrupt the app */
  }
}

// Page loads can re-mount (React StrictMode double-invokes effects in dev); a
// module-level guard keeps "app_open" to one event per actual page load.
let openTracked = false;
export function trackAppOpen(): void {
  if (openTracked) return;
  openTracked = true;
  void track("page_view");
}
