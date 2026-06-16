/**
 * covers — re-host spot cover thumbnails into Supabase Storage.
 *
 * TikTok thumbnail URLs are signed and expire in ~6 days, so the covers stored
 * on existing spots eventually 403. This re-fetches a *fresh* thumbnail per spot
 * via yt-dlp (the stored ones are already expired) and uploads it to the public
 * Storage bucket, then points spots.cover_image_url at that permanent URL.
 *
 * Idempotent: skips spots already served from Storage unless --force. Throttled
 * like scrape, since it hits TikTok once per spot.
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db.ts";
import { requireKeys } from "../env.ts";
import { fetchVideo } from "../lib/ytdlp.ts";
import { jitter, sleep } from "../lib/throttle.ts";
import { ensureCoversBucket, isRehosted, rehostCover } from "../lib/storage.ts";

export const coversCommand = defineCommand({
  meta: {
    name: "covers",
    description:
      "Re-host spot cover thumbnails into Supabase Storage (TikTok URLs expire)",
  },
  args: {
    force: {
      type: "boolean",
      description: "Re-host every spot, including those already on Storage",
    },
  },
  async run({ args }) {
    requireKeys("SUPABASE_URL", "SUPABASE_SECRET_KEY");
    await ensureCoversBucket();

    const spots = await db
      .select({
        id: schema.spots.id,
        placeId: schema.spots.googlePlaceId,
        name: schema.spots.name,
        sourceVideoUrl: schema.spots.sourceVideoUrl,
        coverImageUrl: schema.spots.coverImageUrl,
      })
      .from(schema.spots);

    const todo = spots.filter((s) => args.force || !isRehosted(s.coverImageUrl));
    consola.info(
      `${spots.length} spots, ${todo.length} to re-host${args.force ? " (forced)" : ""}.`,
    );
    if (!todo.length) {
      consola.success("All covers already on Storage. Nothing to do.");
      return;
    }

    let done = 0;
    let failed = 0;
    let skipped = 0;
    for (const [i, s] of todo.entries()) {
      const label = `[${i + 1}/${todo.length}] ${s.name}`;

      // Need a fresh thumbnail URL — the stored one is expired.
      let videoUrl = s.sourceVideoUrl;
      if (!videoUrl) {
        const v = await db
          .select({ url: schema.sourceVideos.url })
          .from(schema.sourceVideos)
          .where(eq(schema.sourceVideos.spotId, s.id))
          .orderBy(desc(schema.sourceVideos.likeCount))
          .limit(1);
        videoUrl = v[0]?.url ?? null;
      }
      if (!videoUrl) {
        skipped++;
        consola.warn(`  ${label} — no source video to re-fetch`);
        continue;
      }

      try {
        const raw = await fetchVideo(videoUrl);
        const hosted = await rehostCover(s.placeId, raw.thumbnail ?? null);
        if (!hosted) {
          failed++;
          consola.warn(`  ${label} — no usable thumbnail`);
        } else {
          await db
            .update(schema.spots)
            .set({ coverImageUrl: hosted, updatedAt: new Date() })
            .where(eq(schema.spots.id, s.id));
          done++;
          consola.log(`  ${label} ✓`);
        }
      } catch (e) {
        failed++;
        const reason =
          (e as Error).message.trim().split("\n").filter(Boolean).pop() ?? "error";
        consola.warn(`  ${label} failed: ${reason}`);
      }

      if (i < todo.length - 1) await sleep(jitter(2000, 5000));
    }

    consola.success(
      `Re-hosted ${done}${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} skipped` : ""}.`,
    );
  },
});
