/**
 * Drizzle client over a direct Postgres connection (CLI only — never imported
 * by the frontend). Bypasses RLS; performs all writes. See docs/schemas.md §0.
 *
 * Lazily connected: the postgres-js client is built on first DB access, not at
 * import, so `spots --help` and pure commands run without DATABASE_URL.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@spots/db";
import { getEnv } from "./env.ts";

type DB = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | null = null;
let instance: DB | null = null;

function connect(): DB {
  // prepare:false only matters behind Supabase's transaction-mode pooler;
  // harmless on the direct/session connection string we use for the CLI.
  client = postgres(getEnv().DATABASE_URL, { prepare: false });
  return drizzle({ client, schema });
}

/** Lazily-connected Drizzle db. First property access opens the connection. */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    instance ??= connect();
    return Reflect.get(instance, prop, receiver);
  },
});

/**
 * Close the connection pool so the process can exit. No-op if never connected.
 * postgres-js keeps the event loop alive otherwise, hanging the CLI after a command.
 */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
    instance = null;
  }
}

export { schema };
