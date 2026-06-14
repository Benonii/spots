/**
 * Stage 5 · geocode (Google Places) → source_videos.geo.
 *
 * For each normalized video with a venueName not yet geocoded, text-search
 * Places for `${venueName} ${neighborhood} Addis Ababa` and cache the result.
 * Idempotent on geocoded_at (stamped whether or not a match is found, so an
 * unresolvable venue isn't re-queried). Within a run, identical queries are
 * memoized so several videos naming one venue cost a single Places call.
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import pLimit from "p-limit";
import type { GeoResult } from "@date-finder/db";
import { db, schema } from "../db.ts";
import { getEnv, requireKeys } from "../env.ts";
import { geocodeVenue } from "../lib/places.ts";
import { rateLimiter } from "../lib/throttle.ts";

const CONCURRENCY = 5;
const QUOTA_RE = /RESOURCE_EXHAUSTED|Quota exceeded|Places 429/i;

export const geocodeCommand = defineCommand({
  meta: {
    name: "geocode",
    description: "Google Places Text Search → source_videos.geo",
  },
  args: { limit: { type: "string", description: "Max videos to process" } },
  async run({ args }) {
    requireKeys("GOOGLE_PLACES_API_KEY");

    const limit = args.limit ? Number(args.limit) : undefined;
    if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
      consola.error("--limit must be a positive number");
      process.exitCode = 1;
      return;
    }

    let q = db
      .select({
        id: schema.sourceVideos.id,
        videoId: schema.sourceVideos.platformVideoId,
        extraction: schema.sourceVideos.extraction,
      })
      .from(schema.sourceVideos)
      .where(
        and(
          isNull(schema.sourceVideos.geocodedAt),
          isNotNull(schema.sourceVideos.extraction),
          sql`${schema.sourceVideos.extraction}->>'venueName' is not null`,
        ),
      )
      .$dynamic();
    if (limit !== undefined) q = q.limit(limit);

    const videos = await q;
    if (!videos.length) {
      consola.info("No venues to geocode.");
      return;
    }
    const rpm = getEnv().GEOCODE_RPM;
    consola.info(
      `Geocoding ${videos.length} venues (concurrency ${CONCURRENCY}, ${rpm}/min)…`,
    );

    // Within-run cache: identical query string → one Places call.
    const cache = new Map<string, Promise<GeoResult | null>>();
    const gate = rateLimiter(rpm); // keep under Places' per-minute quota
    const run = pLimit(CONCURRENCY);
    let resolved = 0;
    let notFound = 0;
    let failed = 0;
    let skipped = 0;
    let quotaHit = false; // circuit breaker: stop hammering once quota is exhausted

    await Promise.all(
      videos.map((v) =>
        run(async () => {
          if (quotaHit) {
            skipped++;
            return; // leaves geocoded_at null → retried on the next run
          }
          const ex = v.extraction!;
          const query = [ex.venueName, ex.neighborhood, "Addis Ababa"]
            .filter(Boolean)
            .join(" ");
          try {
            let pending = cache.get(query);
            if (!pending) {
              pending = gate().then(() => geocodeVenue(query));
              cache.set(query, pending);
            }
            const geo = await pending;
            await db
              .update(schema.sourceVideos)
              .set({ geo, geocodedAt: new Date() })
              .where(eq(schema.sourceVideos.id, v.id));
            if (geo) {
              resolved++;
              consola.log(`  ${ex.venueName} → ${geo.placeId} (${geo.formattedAddress ?? "?"})`);
            } else {
              notFound++;
              consola.log(`  ${ex.venueName} → no match`);
            }
          } catch (e) {
            failed++;
            const reason =
              (e as Error).message.trim().split("\n").filter(Boolean).pop() ??
              "unknown error";
            if (!quotaHit && QUOTA_RE.test(reason)) {
              quotaHit = true;
              consola.warn(
                "Places quota exhausted — stopping geocode. Raise your Google quota (or lower GEOCODE_RPM) and re-run; unprocessed venues retry automatically.",
              );
            }
            consola.warn(`  ${ex.venueName} failed: ${reason}`);
          }
        }),
      ),
    );

    consola.success(
      `Geocoded: ${resolved} resolved, ${notFound} no match, ${failed} failed` +
        (skipped ? `, ${skipped} skipped (quota)` : ""),
    );
  },
});
