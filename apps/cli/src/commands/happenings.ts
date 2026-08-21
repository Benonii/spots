/**
 * `spots happenings` — Telegram channel → happenings.
 *
 *   poll     fetch raw posts (free)
 *   extract  LLM → structured event fields + routing (billed)
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
import { generateObject } from "ai";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import pLimit from "p-limit";
import type { NewHappening } from "@spots/db";
import { db, schema } from "../db.ts";
import { getModel } from "../lib/llm.ts";
import {
  happeningExtractionSchema,
  EXTRACTION_SYSTEM,
  parseEventDate,
  route,
  buildPrompt,
  addisDate,
  type HappeningExtraction,
} from "../happenings-extraction.ts";
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

const CONCURRENCY = 4;

const extract = defineCommand({
  meta: {
    name: "extract",
    description: "LLM: pull event details out of polled posts (billed)",
  },
  args: {
    limit: { type: "string", description: "Max posts to process" },
    all: {
      type: "boolean",
      description: "Re-extract every post (after a prompt change) — re-bills",
    },
    "retry-failed": {
      type: "boolean",
      description: "Re-extract only posts whose previous extraction errored",
    },
    "publish-above": {
      type: "string",
      description:
        "Auto-publish dated future events at or above this confidence (0..1). Omitted = everything goes to review.",
    },
  },
  async run({ args }) {
    const limit = args.limit ? Number(args.limit) : undefined;
    if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
      consola.error("--limit must be a positive number");
      process.exitCode = 1;
      return;
    }

    // No default threshold on purpose. Picking one before there is a sample to
    // calibrate against would be inventing a number, and the cost of getting it
    // wrong is a wrong event in front of users. Until it's set, every event
    // waits for a human.
    const publishAbove =
      args["publish-above"] !== undefined ? Number(args["publish-above"]) : null;
    if (
      publishAbove !== null &&
      (Number.isNaN(publishAbove) || publishAbove < 0 || publishAbove > 1)
    ) {
      consola.error("--publish-above must be between 0 and 1");
      process.exitCode = 1;
      return;
    }

    const model = getModel(); // validates LLM_MODEL + key before spending

    let query = db
      .select({
        id: schema.happenings.id,
        messageId: schema.happenings.sourceMessageId,
        rawText: schema.happenings.rawText,
        postedAt: schema.happenings.postedAt,
      })
      .from(schema.happenings)
      .$dynamic();

    if (args["retry-failed"]) {
      // A failed extraction is stamped but wrote no verdict, so `is_event is
      // null` after `extracted_at` is set is exactly the errored set.
      query = query.where(
        and(
          sql`${schema.happenings.extractedAt} is not null`,
          isNull(schema.happenings.isEvent),
        ),
      );
    } else if (!args.all) {
      query = query.where(isNull(schema.happenings.extractedAt));
    }
    query = query.orderBy(sql`${schema.happenings.sourceMessageId} desc`);
    if (limit !== undefined) query = query.limit(limit);

    const posts = await query;
    if (!posts.length) {
      consola.info("Nothing to extract.");
      return;
    }

    consola.info(
      `Extracting ${posts.length} posts (concurrency ${CONCURRENCY})…${
        publishAbove === null
          ? " Everything routes to review — pass --publish-above to auto-publish."
          : ` Auto-publishing at confidence ≥ ${publishAbove}.`
      }`,
    );

    const run = pLimit(CONCURRENCY);
    const tally = { published: 0, pending: 0, rejected: 0, failed: 0 };

    await Promise.all(
      posts.map((post) =>
        run(async () => {
          const now = new Date();
          try {
            const { object } = await generateObject({
              model,
              schema: happeningExtractionSchema,
              temperature: 0,
              system: EXTRACTION_SYSTEM,
              prompt: buildPrompt(post.postedAt, post.rawText),
            });

            const startsAt = parseEventDate(object.startsAt, now);
            const endsAt = parseEventDate(object.endsAt, now);
            const routed = route(object, startsAt, endsAt, now, publishAbove);

            await db
              .update(schema.happenings)
              .set({
                isEvent: object.isEvent,
                title: object.title,
                summary: object.summary,
                venueName: object.venueName,
                startsAt,
                endsAt,
                priceMin: object.priceMin?.toString() ?? null,
                priceMax: object.priceMax?.toString() ?? null,
                ticketUrl: object.ticketUrl,
                confidence: object.confidence.toString(),
                extractedAt: now,
                status: routed.status,
                rejectedReason: routed.rejectedReason,
                updatedAt: now,
              })
              .where(eq(schema.happenings.id, post.id));

            tally[routed.status]++;
            const when = startsAt ? addisDate(startsAt) : "no date";
            const label = object.isEvent
              ? `${object.title ?? "(untitled)"} · ${when} · ${object.confidence.toFixed(2)}`
              : "(not an event)";
            consola.log(`  ${post.messageId} ${routed.status.padEnd(9)} ${label}`);
          } catch (error) {
            tally.failed++;
            // Stamp anyway. Every billed stage in this pipeline records the
            // attempt so a re-run can't silently re-spend on the same row; the
            // deliberate retry path is --retry-failed, which finds these by
            // their absent verdict.
            await db
              .update(schema.happenings)
              .set({ extractedAt: now, updatedAt: now })
              .where(eq(schema.happenings.id, post.id));
            const reason =
              (error instanceof Error ? error.message : String(error))
                .trim()
                .split("\n")
                .filter(Boolean)
                .pop() ?? "unknown error";
            consola.warn(`  ${post.messageId} failed: ${reason}`);
          }
        }),
      ),
    );

    consola.success(
      `Extracted ${posts.length}: ${tally.published} published, ${tally.pending} to review, ${tally.rejected} rejected, ${tally.failed} failed`,
    );
    if (tally.failed) process.exitCode = 1;
  },
});

const publish = defineCommand({
  meta: {
    name: "publish",
    description: "Re-route already-extracted posts at a confidence threshold (free)",
  },
  args: {
    above: {
      type: "string",
      description: "Publish dated future events at or above this confidence (0..1)",
      required: true,
    },
    "dry-run": {
      type: "boolean",
      description: "Show what would change without writing",
    },
  },
  async run({ args }) {
    const threshold = Number(args.above);
    if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
      consola.error("--above must be between 0 and 1");
      process.exitCode = 1;
      return;
    }

    // Deliberately does not call the LLM. Choosing a threshold is something you
    // do repeatedly while calibrating, and re-running `extract --all` to change
    // one number would re-bill the whole table for output we already have.
    // Rows a human has already ruled on are left alone.
    const rows = await db
      .select({
        id: schema.happenings.id,
        messageId: schema.happenings.sourceMessageId,
        title: schema.happenings.title,
        isEvent: schema.happenings.isEvent,
        startsAt: schema.happenings.startsAt,
        endsAt: schema.happenings.endsAt,
        confidence: schema.happenings.confidence,
        status: schema.happenings.status,
      })
      .from(schema.happenings)
      .where(
        and(
          sql`${schema.happenings.extractedAt} is not null`,
          isNull(schema.happenings.reviewedAt),
        ),
      )
      .orderBy(sql`${schema.happenings.startsAt} asc nulls last`);

    if (!rows.length) {
      consola.info("Nothing extracted to route.");
      return;
    }

    const now = new Date();
    let changed = 0;
    const tally = { published: 0, pending: 0, rejected: 0 };

    for (const row of rows) {
      const routed = route(
        {
          isEvent: row.isEvent ?? false,
          confidence: Number(row.confidence ?? 0),
        } as HappeningExtraction,
        row.startsAt,
        row.endsAt,
        now,
        threshold,
      );
      tally[routed.status]++;
      if (routed.status === row.status) continue;
      changed++;
      consola.log(
        `  ${row.messageId} ${row.status} → ${routed.status.padEnd(9)} ${row.title ?? "(untitled)"}`,
      );
      if (!args["dry-run"]) {
        await db
          .update(schema.happenings)
          .set({
            status: routed.status,
            rejectedReason: routed.rejectedReason,
            updatedAt: now,
          })
          .where(eq(schema.happenings.id, row.id));
      }
    }

    const summary = `${tally.published} published, ${tally.pending} to review, ${tally.rejected} rejected (${changed} changed)`;
    if (args["dry-run"]) consola.info(`Would be: ${summary}`);
    else consola.success(summary);
  },
});

export const happeningsCommand = defineCommand({
  meta: { name: "happenings", description: "Events scraped from Telegram" },
  subCommands: { poll, extract, publish },
});
