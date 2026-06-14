/**
 * ingest — run the whole pipeline in order:
 *   scrape → comments → normalize → geocode → upsert
 *
 * Each stage is dispatched via citty's runCommand, so it keeps its own arg
 * parsing, idempotency, and concurrency. Because every stage reads its work-list
 * from the DB, a failed/interrupted ingest resumes cleanly on re-run — completed
 * work is skipped.
 *
 * Scope: --limit bounds the SCRAPE stage (new videos per channel); the metered
 * downstream stages then process whatever is pending. On a first run with a big
 * backlog that can be a lot of ScrapFly/LLM/Places calls — use --min-views (and
 * run stages individually) when you need finer cost control.
 */
import { defineCommand, runCommand } from "citty";
import { consola } from "consola";
import { scrapeCommand } from "./scrape.ts";
import { commentsCommand } from "./comments.ts";
import { normalizeCommand } from "./normalize.ts";
import { geocodeCommand } from "./geocode.ts";
import { upsertCommand } from "./upsert.ts";

export const ingestCommand = defineCommand({
  meta: {
    name: "ingest",
    description: "Run scrape → comments → normalize → geocode → upsert end-to-end",
  },
  args: {
    channel: { type: "string", description: "Limit the scrape stage to one @handle" },
    limit: { type: "string", description: "Max NEW videos per channel (scrape stage)" },
    "min-views": {
      type: "string",
      description: "Comments stage: only videos above N views",
    },
  },
  async run({ args }) {
    const scrapeArgs: string[] = [];
    if (args.channel) scrapeArgs.push("--channel", args.channel);
    if (args.limit) scrapeArgs.push("--limit", args.limit);

    const commentArgs: string[] = [];
    if (args["min-views"]) commentArgs.push("--min-views", args["min-views"]);

    const stages = [
      { name: "scrape", run: () => runCommand(scrapeCommand, { rawArgs: scrapeArgs }) },
      { name: "comments", run: () => runCommand(commentsCommand, { rawArgs: commentArgs }) },
      { name: "normalize", run: () => runCommand(normalizeCommand, { rawArgs: [] }) },
      { name: "geocode", run: () => runCommand(geocodeCommand, { rawArgs: [] }) },
      { name: "upsert", run: () => runCommand(upsertCommand, { rawArgs: [] }) },
    ];

    for (const [i, stage] of stages.entries()) {
      consola.log(`\n━━━ [${i + 1}/${stages.length}] ${stage.name} ━━━`);
      try {
        await stage.run();
      } catch (e) {
        consola.error(
          `Stage "${stage.name}" failed: ${(e as Error).message.split("\n")[0]}`,
        );
        consola.info(
          "Pipeline stopped. Fix the issue and re-run — completed stages are idempotent, so ingest resumes where it left off.",
        );
        process.exitCode = 1;
        return;
      }
    }

    consola.success("Ingest complete.");
  },
});
