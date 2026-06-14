/**
 * Stage 6 · upsert → spots (+ link source_videos.spot_id).
 *
 * Groups all geocoded videos by google_place_id, aggregates each group into one
 * spot (aggregate.ts → deterministic scoring.ts), and upserts on the place id.
 * Recomputes from ALL of a place's geocoded videos every run, so quality_score
 * and video_count stay correct as more videos arrive. Idempotent.
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "../db.ts";
import { aggregateSpot, type VideoForAgg } from "../aggregate.ts";

export const upsertCommand = defineCommand({
  meta: {
    name: "upsert",
    description: "Aggregate geocoded videos → spots (dedup on google_place_id)",
  },
  async run() {
    const rows = await db
      .select({
        id: schema.sourceVideos.id,
        extraction: schema.sourceVideos.extraction,
        geo: schema.sourceVideos.geo,
        likeCount: schema.sourceVideos.likeCount,
        thumbnailUrl: schema.sourceVideos.thumbnailUrl,
      })
      .from(schema.sourceVideos)
      .where(isNotNull(schema.sourceVideos.geo));

    if (!rows.length) {
      consola.info("No geocoded videos to upsert. Run geocode first.");
      return;
    }

    // Group by place id.
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.geo || !r.extraction) continue;
      const key = r.geo.placeId;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }

    consola.info(`Upserting ${groups.size} spots from ${rows.length} videos…`);

    let upserted = 0;
    for (const [placeId, group] of groups) {
      const videos: VideoForAgg[] = group.map((r) => ({
        extraction: r.extraction!,
        geo: r.geo!,
        engagement: r.likeCount ?? 0,
      }));
      const agg = aggregateSpot(videos);

      const best = [...group].sort(
        (a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0),
      )[0]!;
      const geo = best.geo!;
      const name = best.extraction!.venueName ?? "Unknown";

      const values = {
        googlePlaceId: placeId,
        name,
        neighborhood: agg.neighborhood,
        address: geo.formattedAddress,
        lat: geo.lat,
        lng: geo.lng,
        priceMin: agg.priceMin != null ? String(agg.priceMin) : null,
        priceMax: agg.priceMax != null ? String(agg.priceMax) : null,
        priceCurrency: "ETB",
        priceBasis: agg.priceBasis,
        priceLevel: agg.priceLevel,
        qualityScore: String(agg.qualityScore),
        qualitySignals: agg.qualitySignals,
        tags: agg.tags,
        summary: agg.summary,
        videoCount: agg.videoCount,
        coverImageUrl: best.thumbnailUrl,
        updatedAt: new Date(),
      };

      const [spot] = await db
        .insert(schema.spots)
        .values(values)
        .onConflictDoUpdate({ target: schema.spots.googlePlaceId, set: values })
        .returning({ id: schema.spots.id });

      await db
        .update(schema.sourceVideos)
        .set({ spotId: spot!.id })
        .where(
          inArray(
            schema.sourceVideos.id,
            group.map((r) => r.id),
          ),
        );

      upserted++;
      consola.log(
        `  ${name} — score ${agg.qualityScore}, ${agg.videoCount} video(s), price_level ${agg.priceLevel ?? "—"}`,
      );
    }

    consola.success(`Upserted ${upserted} spots.`);
  },
});
