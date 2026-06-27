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
import { inArray, isNotNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db, schema } from "../db.ts";
import { aggregateSpot, type VideoForAgg } from "../aggregate.ts";
import { ensureCoversBucket, isRehosted, rehostCover, storageConfigured } from "../lib/storage.ts";

/**
 * On re-upsert, keep the existing column value when an admin has locked the
 * logical field it belongs to (spots.locked_fields), otherwise take the freshly
 * scraped value. This is what makes manual edits survive scrapes — see the
 * curation columns in packages/db/src/schema.ts.
 */
function keepIfLocked(lockKey: string, column: AnyColumn, excludedCol: string): SQL {
  return sql`case when ${lockKey} = any(${schema.spots.lockedFields}) then ${column} else excluded.${sql.raw(excludedCol)} end`;
}

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
        url: schema.sourceVideos.url,
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

    // Re-host cover thumbnails into Storage so they don't expire (best-effort:
    // if Storage isn't configured we keep the raw TikTok URL).
    const useStorage = storageConfigured();
    if (useStorage) {
      try {
        await ensureCoversBucket();
      } catch (e) {
        consola.warn(`Storage unavailable, keeping raw cover URLs: ${(e as Error).message}`);
      }
    }

    // Existing covers, so a re-run never clobbers a permanent Storage URL with
    // an expired TikTok thumbnail (rehostCover returns null once the source
    // dies, and we must not fall back to the dead raw URL).
    const existingCovers = new Map<string, string | null>();
    {
      const existing = await db
        .select({
          placeId: schema.spots.googlePlaceId,
          cover: schema.spots.coverImageUrl,
        })
        .from(schema.spots);
      for (const e of existing) existingCovers.set(e.placeId, e.cover);
    }

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

      const prevCover = existingCovers.get(placeId) ?? null;
      let coverImageUrl = prevCover ?? best.thumbnailUrl;
      if (useStorage && isRehosted(prevCover)) {
        // Already permanently hosted — keep it; never re-fetch the expiring source.
        coverImageUrl = prevCover!;
      } else if (useStorage) {
        try {
          const hosted = await rehostCover(placeId, best.thumbnailUrl);
          // On failure (expired source) keep the previous value rather than
          // overwriting with a now-dead raw thumbnail URL.
          if (hosted) coverImageUrl = hosted;
        } catch (e) {
          consola.warn(`  cover re-host failed for ${name}: ${(e as Error).message}`);
        }
      }

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
        coverImageUrl,
        sourceVideoUrl: best.url,
        updatedAt: new Date(),
      };

      // On conflict, refresh scrape-owned fields but defer to admin edits on the
      // six curatable logical fields (name, description, location, tags, price,
      // map). Columns absent here — owner_id, source, hidden, locked_fields,
      // created_by, updated_by, map_url — are never written by the scrape, so
      // curation state is preserved automatically.
      const setOnConflict = {
        name: keepIfLocked("name", schema.spots.name, "name"),
        summary: keepIfLocked("description", schema.spots.summary, "summary"),
        neighborhood: keepIfLocked("location", schema.spots.neighborhood, "neighborhood"),
        address: keepIfLocked("location", schema.spots.address, "address"),
        lat: keepIfLocked("location", schema.spots.lat, "lat"),
        lng: keepIfLocked("location", schema.spots.lng, "lng"),
        priceMin: keepIfLocked("price", schema.spots.priceMin, "price_min"),
        priceMax: keepIfLocked("price", schema.spots.priceMax, "price_max"),
        priceCurrency: keepIfLocked("price", schema.spots.priceCurrency, "price_currency"),
        priceBasis: keepIfLocked("price", schema.spots.priceBasis, "price_basis"),
        priceLevel: keepIfLocked("price", schema.spots.priceLevel, "price_level"),
        tags: keepIfLocked("tags", schema.spots.tags, "tags"),
        // an admin-set cover is locked too, so a re-scrape won't revert it:
        coverImageUrl: keepIfLocked("cover", schema.spots.coverImageUrl, "cover_image_url"),
        // scrape-owned, never admin-editable — always refreshed:
        qualityScore: values.qualityScore,
        qualitySignals: values.qualitySignals,
        videoCount: values.videoCount,
        sourceVideoUrl: values.sourceVideoUrl,
        updatedAt: values.updatedAt,
      };

      const [spot] = await db
        .insert(schema.spots)
        .values(values)
        .onConflictDoUpdate({ target: schema.spots.googlePlaceId, set: setOnConflict })
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
