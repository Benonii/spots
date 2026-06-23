/**
 * Env loading + validation. Bun auto-loads `.env` from the repo root.
 *
 * DATABASE_URL is required for anything that touches the DB. The per-stage API
 * keys are validated lazily by `requireKeys()` so `spots --help` and pure commands
 * don't fail when a key they don't use is absent.
 */
import { z } from "zod";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Load the repo-root .env regardless of the process's cwd. Bun only auto-loads
// .env from the current directory, so `bun run spots` launched from a subpackage
// (e.g. apps/cli) would otherwise miss it. Does not override vars already set.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  // LLM: provider-agnostic. "provider:model-id" (provider ∈ openai | google).
  LLM_MODEL: z.string().min(1).optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  GOOGLE_PLACES_API_KEY: z.string().min(1).optional(),
  SCRAPFLY_KEY: z.string().min(1).optional(),
  // Supabase project URL + secret (service-role) key — used to re-host TikTok
  // cover thumbnails into Storage (their CDN URLs are signed and expire in days).
  // Secret key bypasses RLS; CLI-only, never exposed to the browser.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  // Geocode rate cap (Places Text Search starts/min). Keep under your Google
  // per-minute quota; raise it if your quota allows, lower it if still throttled.
  GEOCODE_RPM: z.coerce.number().int().positive().default(60),
  // Path/name of the yt-dlp binary. Override if it isn't on PATH
  // (e.g. ~/.local/bin/yt-dlp from a standalone install).
  YT_DLP_BIN: z.string().default("yt-dlp"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parse + cache process.env. Throws a readable error naming missing/invalid vars. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment. Check your .env (see .env.example):\n${issues}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Assert that specific optional keys are present before running a metered stage. */
export function requireKeys<K extends keyof Env>(...keys: K[]): void {
  const env = getEnv();
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required env for this command: ${missing.join(", ")}. Add them to .env.`,
    );
  }
}
