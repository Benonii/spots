/**
 * Sharing a spot as a link.
 *
 * The URL is the `?spot=<place_id>` deep link the carousel already honours for
 * /near — no new route, and a shared link lands on the card rather than a
 * random one.
 *
 * The link preview is the site's generic OG card, not the spot's. Per-spot
 * previews need a server rendering meta tags per URL; this is a SPA behind a
 * blanket rewrite to index.html, and Telegram/WhatsApp scrapers don't run JS.
 * See docs/ideas.md §5.
 */

export type ShareOutcome =
  /** handed to the OS share sheet */
  | "shared"
  /** copied to the clipboard instead — caller should confirm visibly */
  | "copied"
  /** the user backed out of the share sheet; say nothing */
  | "dismissed"
  | "failed";

export function spotShareUrl(placeId: string, origin: string): string {
  return `${origin}/?spot=${encodeURIComponent(placeId)}`;
}

/** What a shared spot says in the message body, above the link. */
export function spotShareText(name: string, neighborhood?: string | null): string {
  return neighborhood ? `${name} — ${neighborhood}, Addis Ababa` : `${name} — Addis Ababa`;
}

type ShareDeps = {
  share?: (data: ShareData) => Promise<void>;
  copy?: (text: string) => Promise<void>;
};

/**
 * Share sheet where there is one, clipboard where there isn't.
 *
 * A cancelled share sheet rejects with AbortError, which is a user decision and
 * not a failure — reporting it as one would flash an error at someone who
 * simply changed their mind.
 */
export async function shareLink(
  data: { title: string; text: string; url: string },
  deps: ShareDeps = {},
): Promise<ShareOutcome> {
  const share =
    deps.share ??
    (typeof navigator !== "undefined" && navigator.share
      ? navigator.share.bind(navigator)
      : undefined);
  const copy =
    deps.copy ??
    (typeof navigator !== "undefined" && navigator.clipboard
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : undefined);

  if (share) {
    try {
      await share(data);
      return "shared";
    } catch (error) {
      if ((error as DOMException | undefined)?.name === "AbortError") return "dismissed";
      // Anything else (permission, unsupported payload) falls through to a copy,
      // which is the more reliable path anyway.
    }
  }

  if (copy) {
    try {
      await copy(data.url);
      return "copied";
    } catch {
      return "failed";
    }
  }
  return "failed";
}
