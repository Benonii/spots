/**
 * Stage 1–2 · scrape (yt-dlp) → source_videos.
 *
 * Enumerate each channel (flat, cheap), skip videos already stored (dedup on
 * platform_video_id), then fetch full metadata per NEW video and insert it.
 * Throttled with a 2–5s jittered sleep between metadata fetches — TikTok blocks
 * fast/uniform patterns and blocks stick. Per-video failures are isolated.
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { eq, inArray } from "drizzle-orm";
import type { NewSourceVideo } from "@date-finder/db";
import { db, schema } from "../db.ts";
import { enumerateChannel, fetchVideo, type RawVideo } from "../lib/ytdlp.ts";
import { sleep, jitter } from "../lib/throttle.ts";

const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;

function parseHashtags(text: string | null): string[] {
  if (!text) return [];
  return [...text.matchAll(HASHTAG_RE)].map((m) => m[1]!);
}

function mapVideo(channelId: string, v: RawVideo): NewSourceVideo {
  const caption = v.description ?? v.title ?? null;
  return {
    channelId,
    platformVideoId: v.id,
    url: v.webpage_url ?? v.url ?? `https://www.tiktok.com/video/${v.id}`,
    caption,
    hashtags: v.tags?.length ? v.tags : parseHashtags(caption),
    viewCount: v.view_count ?? null,
    likeCount: v.like_count ?? null,
    commentCount: v.comment_count ?? null,
    shareCount: v.repost_count ?? null,
    postedAt: v.timestamp ? new Date(v.timestamp * 1000) : null,
    thumbnailUrl: v.thumbnail ?? null,
  };
}

export const scrapeCommand = defineCommand({
  meta: {
    name: "scrape",
    description:
      "yt-dlp: enumerate channels + per-video metadata → source_videos",
  },
  args: {
    channel: { type: "string", description: "Limit to one @handle" },
    limit: { type: "string", description: "Max NEW videos per channel" },
  },
  async run({ args }) {
    const limit = args.limit ? Number(args.limit) : Infinity;
    if (Number.isNaN(limit) || limit <= 0) {
      consola.error("--limit must be a positive number");
      process.exitCode = 1;
      return;
    }

    const channels = await db
      .select()
      .from(schema.channels)
      .where(
        args.channel
          ? eq(schema.channels.handle, args.channel)
          : eq(schema.channels.active, true),
      );

    if (!channels.length) {
      consola.warn(
        args.channel
          ? `No channel ${args.channel}.`
          : "No active channels. Add one: spots channels add <url>",
      );
      return;
    }

    for (const channel of channels) {
      consola.start(`Enumerating ${channel.handle}…`);
      let listed;
      try {
        listed = await enumerateChannel(channel.url);
      } catch (e) {
        consola.error(
          `Enumerate failed for ${channel.handle}: ${(e as Error).message.split("\n")[0]}`,
        );
        continue;
      }

      // Dedup: drop videos we already have (platform_video_id is globally unique).
      const ids = listed.map((l) => l.id);
      const existing = ids.length
        ? await db
            .select({ id: schema.sourceVideos.platformVideoId })
            .from(schema.sourceVideos)
            .where(inArray(schema.sourceVideos.platformVideoId, ids))
        : [];
      const known = new Set(existing.map((r) => r.id));
      const fresh = listed.filter((l) => !known.has(l.id)).slice(0, limit);

      consola.info(
        `${channel.handle}: ${listed.length} listed, ${known.size} stored, ${fresh.length} to fetch`,
      );

      let inserted = 0;
      let failed = 0;
      for (const [i, item] of fresh.entries()) {
        try {
          const raw = await fetchVideo(item.url);
          await db
            .insert(schema.sourceVideos)
            .values(mapVideo(channel.id, raw))
            .onConflictDoNothing({
              target: schema.sourceVideos.platformVideoId,
            });
          inserted++;
          consola.log(`  [${i + 1}/${fresh.length}] ${raw.id} ✓`);
        } catch (e) {
          failed++;
          // yt-dlp's real reason is the last stderr line (e.g. "ERROR: …"),
          // not the leading "Command failed" line.
          const reason =
            (e as Error).message.trim().split("\n").filter(Boolean).pop() ??
            "unknown error";
          consola.warn(`  [${i + 1}/${fresh.length}] ${item.id} failed: ${reason}`);
        }
        if (i < fresh.length - 1) await sleep(jitter(2000, 5000));
      }

      await db
        .update(schema.channels)
        .set({ lastScrapedAt: new Date() })
        .where(eq(schema.channels.id, channel.id));

      consola.success(
        `${channel.handle}: +${inserted} videos${failed ? `, ${failed} failed` : ""}`,
      );
    }
  },
});
