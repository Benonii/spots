import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// drizzle-kit runs with cwd = packages/db and does not inherit the repo-root
// .env, so load it explicitly (resolved relative to this file → repo root).
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Required so drizzle-kit emits the RLS policies declared in schema.ts:
  entities: { roles: { provider: "supabase" } },
});
