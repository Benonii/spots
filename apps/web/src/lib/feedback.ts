import { supabase } from "./supabase";

/**
 * User-submitted feedback. Open to everyone (no sign-in required) — the
 * `feedback` table's RLS allows anon + authenticated inserts and exposes no
 * read policy, so submissions are write-only from the client. `user_id` is
 * stamped server-side from the JWT when signed in; we never send it.
 */

export type FeedbackKind = "bug" | "feature" | "general";

export async function submitFeedback(input: {
  kind: FeedbackKind;
  message: string;
  email?: string | null;
}): Promise<void> {
  const message = input.message.trim();
  if (!message) throw new Error("Message is required.");

  const { error } = await supabase.from("feedback").insert({
    kind: input.kind,
    message: message.slice(0, 2000), // mirror the DB length check
    email: input.email?.trim() || null,
    page_url: typeof window !== "undefined" ? window.location.pathname : null,
    user_agent:
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
  });
  if (error) throw new Error(error.message);
}
