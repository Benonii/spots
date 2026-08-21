/**
 * `spots happenings poll` — Telegram channel → happenings (raw, unextracted).
 *
 * Walks a channel's public preview page backwards until it reaches posts it
 * already has, inserting each new one with `status = 'pending'` and no
 * extraction. Splitting the poll from the LLM stage keeps this half free to
 * re-run: the scrape costs nothing, so the stop rule can afford to be generous.
 *
 * Dedup is `(source_channel, source_message_id)`. Re-polling is therefore a
 * no-op for anything already stored — including posts already reviewed and
 * rejected, which never come back for a second look.
 *
 * Known gap: a post edited on Telegram after we store it (a cancellation, a
 * moved date) is not detected. Deliberate for v1.
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { and, eq, inArray } from "drizzle-orm";
import type { NewHappening } from "@spots/db";
import { db, schema } from "../db.ts";
import { fetchChannelPage, type TelegramPost } from "../lib/telegram.ts";
import { sleep, jitter } from "../lib/throttle.ts";

const DEFAULT_CHANNEL = "linkupaddis";

/** Safety bound on the backwards walk; the catch-up rule normally stops sooner. */
const DEFAULT_MAX_PAGES = 10;

/** '@LinkUpAddis' / 'https://t.me/s/LinkUpAddis' / 'LinkUpAddis' → 'linkupaddis'. */
function normalizeChannel(input: string): string {
  const handle = input.replace(/^https?:\/\/t\.me\/(s\/)?/i, "").replace(/^@/, "");
  return handle.split(/[/?]/)[0]!.toLowerCase();
}

function toRow(channel: string, post: TelegramPost): NewHappening {
  return {
    sourceChannel: channel,
    sourceMessageId: post.messageId,
    sourceUrl: post.url,
    rawText: post.text,
    imageUrl: post.imageUrl,
    postedAt: post.postedAt,
  };
}

const poll = defineCommand({
  meta: {
    name: "poll",
    description: "Fetch new posts from a Telegram channel into happenings",
  },
  args: {
    channel: {
      type: "string",
      description: `Channel handle (default ${DEFAULT_CHANNEL})`,
    },
    pages: {
      type: "string",
      description: `Max pages to walk back (default ${DEFAULT_MAX_PAGES}, 20 posts each)`,
    },
  },
  async run({ args }) {
    const channel = normalizeChannel(args.channel ?? DEFAULT_CHANNEL);
    const maxPages = args.pages ? Number(args.pages) : DEFAULT_MAX_PAGES;
    if (!Number.isInteger(maxPages) || maxPages <= 0) {
      consola.error("--pages must be a positive integer");
      process.exitCode = 1;
      return;
    }

    consola.start(`Polling t.me/s/${channel}…`);

    let before: number | undefined;
    let inserted = 0;
    let skippedEmpty = 0;
    let pagesWalked = 0;
    let failure: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      let posts: TelegramPost[];
      try {
        posts = await fetchChannelPage(channel, before);
      } catch (error) {
        failure = `Page fetch failed: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
      pagesWalked++;

      // Photo-only posts carry nothing to extract an event from.
      const usable = posts.filter((post) => post.text.length > 0);
      skippedEmpty += posts.length - usable.length;

      // On the first page, an empty result is not "the channel is empty" — it's
      // the parser having lost the markup it depends on, which is the failure
      // this whole command has to be loud about. A silent success here would
      // read as "no new events" twice a day, forever, while same-day events
      // (30% of this channel's output) expire unseen. See the scheduled-ingest
      // decision in docs/ideas.md: a timer with no health signal is
      // indistinguishable from the staleness it was added to prevent.
      //
      // Two shapes, because `data-post` is the most stable attribute on the
      // page: no posts at all, or posts whose text selector went stale and now
      // yields nothing.
      if (page === 0 && !posts.length) {
        failure = `No posts parsed from t.me/s/${channel}. The page markup has changed, or the channel is gone.`;
        break;
      }
      if (page === 0 && !usable.length) {
        failure = `Parsed ${posts.length} posts from t.me/s/${channel} but none carried text. The message-text selector has gone stale.`;
        break;
      }

      if (!posts.length) {
        consola.info("Reached the start of the channel.");
        break;
      }

      const ids = usable.map((post) => post.messageId);
      const stored = ids.length
        ? await db
            .select({ messageId: schema.happenings.sourceMessageId })
            .from(schema.happenings)
            .where(
              and(
                eq(schema.happenings.sourceChannel, channel),
                inArray(schema.happenings.sourceMessageId, ids),
              ),
            )
        : [];
      const known = new Set(stored.map((row) => row.messageId));
      const fresh = usable.filter((post) => !known.has(post.messageId));

      // Count what the insert actually wrote rather than what we offered it:
      // a concurrent run can take a row between the dedup read and this write,
      // and onConflictDoNothing swallows that difference silently.
      const written = fresh.length
        ? await db
            .insert(schema.happenings)
            .values(fresh.map((post) => toRow(channel, post)))
            .onConflictDoNothing({
              target: [
                schema.happenings.sourceChannel,
                schema.happenings.sourceMessageId,
              ],
            })
            .returning({ id: schema.happenings.id })
        : [];
      inserted += written.length;

      consola.log(
        `  page ${page + 1}: ${posts.length} posts, ${written.length} new`,
      );

      // Caught up: every post on this page that we'd store was already stored,
      // so everything older is too. Guarded on `usable` rather than the raw
      // page: photo-only posts are never inserted, so a page made entirely of
      // them has nothing new by definition and would end the walk early —
      // truncating a backfill that hasn't actually caught up yet.
      if (usable.length && !fresh.length) break;

      before = Math.min(...posts.map((post) => post.messageId));
      await sleep(jitter(2000, 5000));
    }

    const summary = `${channel}: +${inserted} pending${skippedEmpty ? `, ${skippedEmpty} skipped (no text)` : ""} over ${pagesWalked} page${pagesWalked === 1 ? "" : "s"}`;

    // A partial walk is still a failure: the scheduled run must go red so the
    // breakage surfaces, rather than printing a success line with fewer rows.
    if (failure) {
      consola.error(failure);
      consola.info(summary);
      process.exitCode = 1;
      return;
    }

    consola.success(summary);
  },
});

export const happeningsCommand = defineCommand({
  meta: { name: "happenings", description: "Events scraped from Telegram" },
  subCommands: { poll },
});
