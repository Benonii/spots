import { defineCommand } from "citty";
import { consola } from "consola";
import { eq } from "drizzle-orm";
import { db, schema } from "../db.ts";

/** Derive '@handle' from a TikTok URL like https://www.tiktok.com/@addis_food_reviews. */
function deriveHandle(url: string): string | null {
  const m = url.match(/@([A-Za-z0-9._]+)/);
  return m ? `@${m[1]}` : null;
}

const add = defineCommand({
  meta: { name: "add", description: "Track a TikTok review channel" },
  args: {
    url: { type: "positional", description: "Channel URL", required: true },
    handle: { type: "string", description: "Override the @handle" },
    name: { type: "string", description: "Display name" },
  },
  async run({ args }) {
    const handle = args.handle ?? deriveHandle(args.url);
    if (!handle) {
      consola.error(
        `Could not derive a handle from "${args.url}". Pass --handle @name.`,
      );
      process.exitCode = 1;
      return;
    }
    const [row] = await db
      .insert(schema.channels)
      .values({ handle, url: args.url, displayName: args.name })
      .onConflictDoNothing({ target: schema.channels.handle })
      .returning();

    if (row) consola.success(`Tracking ${handle}`);
    else consola.info(`${handle} is already tracked.`);
  },
});

const list = defineCommand({
  meta: { name: "list", description: "List tracked channels" },
  async run() {
    const rows = await db.select().from(schema.channels);
    if (!rows.length) {
      consola.info("No channels yet. Add one: df channels add <url>");
      return;
    }
    for (const c of rows) {
      const state = c.active ? "active" : "inactive";
      const last = c.lastScrapedAt?.toISOString() ?? "never scraped";
      consola.log(`${c.handle.padEnd(28)} ${state.padEnd(9)} ${last}`);
    }
  },
});

const deactivate = defineCommand({
  meta: { name: "deactivate", description: "Stop scraping a channel" },
  args: {
    handle: { type: "positional", description: "@handle", required: true },
  },
  async run({ args }) {
    const [row] = await db
      .update(schema.channels)
      .set({ active: false })
      .where(eq(schema.channels.handle, args.handle))
      .returning();
    if (row) consola.success(`Deactivated ${args.handle}`);
    else consola.warn(`No channel ${args.handle}`);
  },
});

export const channelsCommand = defineCommand({
  meta: { name: "channels", description: "Manage tracked review channels" },
  subCommands: { add, list, deactivate },
});
