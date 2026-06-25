/**
 * Stage 4 · normalize (LLM) → source_videos.extraction.
 *
 * One schema-constrained `generateObject` call per video over caption + top
 * comments, producing the extraction contract (see extraction.ts / schemas.md
 * §5). Provider-agnostic model via getModel(). temperature 0 for determinism.
 *
 * Idempotent on normalized_at: re-runs only touch unprocessed rows; --all forces
 * a full re-run (e.g. after tuning this prompt) without re-scraping. venueName
 * may be null (no identifiable place) — still marked normalized, but it yields
 * no geocode target downstream.
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { generateObject } from "ai";
import { eq, isNull, sql } from "drizzle-orm";
import pLimit from "p-limit";
import type { TopComment } from "@spots/db";
import { db, schema } from "../db.ts";
import { getModel } from "../lib/llm.ts";
import { extractionSchema } from "../extraction.ts";

const CONCURRENCY = 4;

const SYSTEM = `You extract structured data about a date-spot venue from an Addis Ababa TikTok review.

You receive a video CAPTION and its TOP COMMENTS (Amharic and/or English). The caption usually names the venue (often after 📌) and its area (often after 📍) and may state a price. The comments carry audience reaction — aesthetic, vibe, food, service, and whether it's worth the price.

Rules:
- venueName: the specific place reviewed. null if no identifiable venue is named (a generic listicle, an event, a food bazaar, a recipe).
- neighborhood: the Addis Ababa area (e.g. Bole, Kazanchis, Sarbet, Piassa, Gerji). null if not stated.
- price: amounts in Ethiopian Birr (ETB). min/max are numbers; max is null unless a range is given. basis is "per_person", "total" (whole bill/table), or "unknown". If a comment states a concrete bill (e.g. "we paid 10800 for two"), prefer that over a vaguer caption figure.
- tags: short lowercase descriptors, e.g. "rooftop","coffee","brunch","quiet","romantic","view".
- summary: one neutral sentence describing the spot.
- dimensions (0–5): aesthetic, vibe, food, value, service — judged from BOTH caption and comments. Handle negation correctly: "not aesthetic", "wouldn't recommend", "overpriced", "የማይመከር" LOWER the relevant score. When there is no signal for a dimension, use 2.5 (neutral) — do NOT inflate.
- evidence: integer counts over the comments — positiveMentions, negativeMentions, and aestheticMentions (comments about looks/decor/view).

Judge only from the provided text. Never invent venues, prices, or reactions.`;

function buildPrompt(caption: string | null, comments: TopComment[]): string {
  const cap = caption?.trim() || "(no caption)";
  const body = comments.length
    ? comments.map((c) => `- (♥${c.likes}) ${c.text}`).join("\n")
    : "(no comments)";
  return `CAPTION:\n${cap}\n\nTOP COMMENTS (most-liked first):\n${body}`;
}

export const normalizeCommand = defineCommand({
  meta: {
    name: "normalize",
    description: "LLM generateObject → source_videos.extraction",
  },
  args: {
    limit: { type: "string", description: "Max videos to process" },
    all: {
      type: "boolean",
      description: "Re-normalize every video (after a prompt change)",
    },
  },
  async run({ args }) {
    const limit = args.limit ? Number(args.limit) : undefined;
    if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
      consola.error("--limit must be a positive number");
      process.exitCode = 1;
      return;
    }

    const model = getModel(); // validates LLM_MODEL + key

    let q = db
      .select({
        id: schema.sourceVideos.id,
        videoId: schema.sourceVideos.platformVideoId,
        caption: schema.sourceVideos.caption,
        comments: schema.sourceVideos.topComments,
      })
      .from(schema.sourceVideos)
      .$dynamic();
    if (!args.all) q = q.where(isNull(schema.sourceVideos.normalizedAt));
    q = q.orderBy(sql`${schema.sourceVideos.viewCount} desc nulls last`);
    if (limit !== undefined) q = q.limit(limit);

    const videos = await q;
    if (!videos.length) {
      consola.info("No videos to normalize.");
      return;
    }
    consola.info(
      `Normalizing ${videos.length} videos (concurrency ${CONCURRENCY})…`,
    );

    const run = pLimit(CONCURRENCY);
    let withVenue = 0;
    let noVenue = 0;
    let failed = 0;

    await Promise.all(
      videos.map((v) =>
        run(async () => {
          try {
            const { object } = await generateObject({
              model,
              schema: extractionSchema,
              temperature: 0,
              system: SYSTEM,
              prompt: buildPrompt(v.caption, v.comments),
            });
            await db
              .update(schema.sourceVideos)
              .set({ extraction: object, normalizedAt: new Date() })
              .where(eq(schema.sourceVideos.id, v.id));
            if (object.venueName) withVenue++;
            else noVenue++;
            const loc = object.neighborhood ? ` · ${object.neighborhood}` : "";
            consola.log(`  ${v.videoId}: ${object.venueName ?? "(no venue)"}${loc}`);
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
      `Normalized: ${withVenue} with venue, ${noVenue} no venue, ${failed} failed`,
    );
  },
});
