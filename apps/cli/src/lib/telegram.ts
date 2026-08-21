/**
 * Telegram channel reader — the source for `happenings`.
 *
 * Telegram publishes a channel's public posts as plain HTML at
 * `t.me/s/<channel>`: no API key, no bot membership, no login, and none of
 * TikTok's rate-limit hostility. Twenty posts per page, oldest-first, paginated
 * backwards with `?before=<message_id>`.
 *
 * Message ids are monotonic per channel, so the lowest id on a page is both the
 * cursor for the next page and half of the dedup key (`source_channel` is the
 * other half — ids are only unique within a channel).
 */

/** One public post. `text` is empty for photo-only posts; they're skipped upstream. */
export type TelegramPost = {
  messageId: number;
  url: string;
  text: string;
  imageUrl: string | null;
  postedAt: Date | null;
};

const BASE = "https://t.me/s";

// t.me serves a stripped page to clients it doesn't recognise as a browser.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * HTMLRewriter hands back text chunks exactly as they appear in the source, so
 * entities are still encoded. Nothing in Bun decodes them for us.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) {
      return String.fromCodePoint(Number(body.slice(1)));
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** `background-image:url('https://cdn4.telesco.pe/…')` → the URL. */
function backgroundImageUrl(style: string | null): string | null {
  return style?.match(/background-image:url\('([^']+)'\)/)?.[1] ?? null;
}

/**
 * Parse a `t.me/s/<channel>` page. Split out from the fetch so it can be tested
 * against saved HTML — the markup is the part that will break one day, not the
 * request.
 */
export function parseChannelPage(html: string): TelegramPost[] {
  const posts: TelegramPost[] = [];
  const last = (): TelegramPost | undefined => posts[posts.length - 1];

  new HTMLRewriter()
    // Opens a new post. Every handler below writes into the most recent one,
    // which is safe because messages don't nest.
    .on("div.tgme_widget_message[data-post]", {
      element(el) {
        const post = el.getAttribute("data-post") ?? "";
        const messageId = Number(post.split("/")[1]);
        if (!Number.isFinite(messageId)) return;
        posts.push({
          messageId,
          url: `https://t.me/${post}`,
          text: "",
          imageUrl: null,
          postedAt: null,
        });
      },
    })
    // The post's own photo. Deliberately not `.tgme_widget_message_user_photo`,
    // which is the channel's avatar and identical on every row.
    .on("a.tgme_widget_message_photo_wrap", {
      element(el) {
        const target = last();
        if (target) target.imageUrl ??= backgroundImageUrl(el.getAttribute("style"));
      },
    })
    .on("i.tgme_widget_message_video_thumb", {
      element(el) {
        const target = last();
        if (target) target.imageUrl ??= backgroundImageUrl(el.getAttribute("style"));
      },
    })
    // Line breaks carry real meaning here — "Location:" and "Tickets:" live on
    // their own lines — and a text handler alone would run them together.
    .on("div.tgme_widget_message_text br", {
      element() {
        const target = last();
        if (target) target.text += "\n";
      },
    })
    .on("div.tgme_widget_message_text", {
      text(chunk) {
        const target = last();
        if (target) target.text += chunk.text;
      },
    })
    .on("a.tgme_widget_message_date time", {
      element(el) {
        const target = last();
        const datetime = el.getAttribute("datetime");
        if (target && datetime) target.postedAt = new Date(datetime);
      },
    })
    .transform(html);

  return posts.map((post) => ({
    ...post,
    // U+200B: the channel opens most paragraphs with a zero-width space.
    text: decodeEntities(post.text).replace(/​/g, "").trim(),
  }));
}

/**
 * One page of posts, newest last. `before` pages backwards: pass the lowest
 * message id seen so far to get the twenty posts preceding it.
 */
export async function fetchChannelPage(
  channel: string,
  before?: number,
): Promise<TelegramPost[]> {
  const url = new URL(`${BASE}/${channel}`);
  if (before !== undefined) url.searchParams.set("before", String(before));

  const response = await fetch(url, { headers: { "user-agent": UA } });
  if (!response.ok) {
    throw new Error(`t.me/${channel} returned ${response.status}`);
  }
  return parseChannelPage(await response.text());
}
