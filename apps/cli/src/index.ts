#!/usr/bin/env bun
/**
 * date-finder ingestion CLI (`df`). Command surface per
 * docs/plans/cli-implementation-plan.md §5.
 */
import { defineCommand, runMain } from "citty";
import { closeDb } from "./db.ts";

// Silence per-call AI SDK warnings (e.g. reasoning models ignoring `temperature`),
// which would otherwise print once per video during normalize.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
import { channelsCommand } from "./commands/channels.ts";
import { scrapeCommand } from "./commands/scrape.ts";
import { commentsCommand } from "./commands/comments.ts";
import { normalizeCommand } from "./commands/normalize.ts";
import { geocodeCommand } from "./commands/geocode.ts";
import { upsertCommand } from "./commands/upsert.ts";
import { ingestCommand } from "./commands/ingest.ts";
import {
  migrateCommand,
  generateCommand,
  pushCommand,
} from "./commands/db.ts";

const main = defineCommand({
  meta: {
    name: "df",
    description: "date-finder — TikTok review ingestion pipeline",
  },
  subCommands: {
    channels: channelsCommand,
    scrape: scrapeCommand,
    comments: commentsCommand,
    normalize: normalizeCommand,
    geocode: geocodeCommand,
    upsert: upsertCommand,
    ingest: ingestCommand,
    migrate: migrateCommand,
    generate: generateCommand,
    push: pushCommand,
  },
});

try {
  await runMain(main);
} finally {
  // postgres-js holds the event loop open; close so the CLI exits.
  await closeDb();
}
