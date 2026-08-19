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

    for (let page = 0; page < maxPages; page++) {
      let posts: TelegramPost[];
      try {
        posts = await fetchChannelPage(channel, before);
      } catch (error) {
        consola.error(
          `Page fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
        break;
      }
      pagesWalked++;

      if (!posts.length) {
        consola.info("Reached the start of the channel.");
        break;
      }

      // Photo-only posts carry nothing to extract an event from.
      const usable = posts.filter((post) => post.text.length > 0);
      skippedEmpty += posts.length - usable.length;

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

      if (fresh.length) {
        await db
          .insert(schema.happenings)
          .values(fresh.map((post) => toRow(channel, post)))
          .onConflictDoNothing({
            target: [
              schema.happenings.sourceChannel,
              schema.happenings.sourceMessageId,
            ],
          });
        inserted += fresh.length;
      }

      consola.log(
        `  page ${page + 1}: ${posts.length} posts, ${fresh.length} new`,
      );

      // Caught up: this page was entirely stored already, so everything older is too.
      if (!fresh.length) break;

      before = Math.min(...posts.map((post) => post.messageId));
      await sleep(jitter(2000, 5000));
    }

    consola.success(
      `${channel}: +${inserted} pending${skippedEmpty ? `, ${skippedEmpty} skipped (no text)` : ""} over ${pagesWalked} page${pagesWalked === 1 ? "" : "s"}`,
    );
  },
});

export const happeningsCommand = defineCommand({
  meta: { name: "happenings", description: "Events scraped from Telegram" },
  subCommands: { poll },
});
