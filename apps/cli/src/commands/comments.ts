/**
 * Stage 3 · comments (ScrapFly) → source_videos.top_comments.
 *
 * The only metered stage. Selects videos not yet sent through ScrapFly
 * (comments_scraped_at IS NULL), highest-view first (most worth scoring), and
 * fetches their top comments. Scope with --limit / --min-views to control credit
 * spend. Idempotent: comments_scraped_at is stamped whether or not comments came
 * back, so a re-run never re-spends on the same video.
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { db, schema } from "../db.ts";
import { requireKeys } from "../env.ts";
import { fetchTopComments } from "../lib/scrapfly.ts";

const CONCURRENCY = 3; // ScrapFly free tier has limited concurrent slots

export const commentsCommand = defineCommand({
  meta: {
    name: "comments",
    description: "ScrapFly: top ~20 comments per video → top_comments (metered)",
  },
  args: {
    limit: { type: "string", description: "Max videos to process" },
    "min-views": { type: "string", description: "Only videos above N views" },
  },
  async run({ args }) {
    requireKeys("SCRAPFLY_KEY");

    const limit = args.limit ? Number(args.limit) : undefined;
    const minViews = args["min-views"] ? Number(args["min-views"]) : undefined;
    if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
      consola.error("--limit must be a positive number");
      process.exitCode = 1;
      return;
    }
    if (minViews !== undefined && Number.isNaN(minViews)) {
      consola.error("--min-views must be a number");
      process.exitCode = 1;
      return;
    }

    const conds = [isNull(schema.sourceVideos.commentsScrapedAt)];
    if (minViews !== undefined) {
      conds.push(gte(schema.sourceVideos.viewCount, minViews));
    }

    let q = db
      .select({
        id: schema.sourceVideos.id,
        videoId: schema.sourceVideos.platformVideoId,
        views: schema.sourceVideos.viewCount,
      })
      .from(schema.sourceVideos)
      .where(and(...conds))
      .orderBy(sql`${schema.sourceVideos.viewCount} desc nulls last`)
      .$dynamic();
    if (limit !== undefined) q = q.limit(limit);

    const videos = await q;
    if (!videos.length) {
      consola.info("No videos need comments.");
      return;
    }
    consola.info(
      `Fetching comments for ${videos.length} videos (concurrency ${CONCURRENCY})…`,
    );

    const run = pLimit(CONCURRENCY);
    let withComments = 0;
    let empty = 0;
    let failed = 0;

    await Promise.all(
      videos.map((v) =>
        run(async () => {
          try {
            const comments = await fetchTopComments(v.videoId);
            await db
              .update(schema.sourceVideos)
              .set({ topComments: comments, commentsScrapedAt: new Date() })
              .where(eq(schema.sourceVideos.id, v.id));
            if (comments.length) withComments++;
            else empty++;
            consola.log(`  ${v.videoId}: ${comments.length} comments`);
          } catch (e) {
            failed++;
            const reason =
              (e as Error).message.trim().split("\n").filter(Boolean).pop() ??
              "unknown error";
            consola.warn(`  ${v.videoId} failed: ${reason}`);
          }
        }),
      ),
    );

    consola.success(
      `Comments: ${withComments} with comments, ${empty} empty, ${failed} failed`,
    );
  },
});
