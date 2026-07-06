/**
 * `spots backup` — pg_dump the app's data (public schema) to a timestamped
 * file on secondary storage. Run before every ingest so curation (admin spots,
 * edits, ownership, hidden state, suppressions) is recoverable if a scrape
 * ever misbehaves.
 *
 * Scoped to `-n public`: Supabase-internal schemas (auth, storage, realtime,
 * vault, …) are partly unreadable to the `postgres` role — an unscoped dump
 * aborts on them, and they can't be pg_restore'd into a Supabase project
 * anyway. auth.users is therefore NOT in the dump; restoring into the same
 * project (where auth is intact) is the supported recovery path.
 *
 * ACLs are kept (no --no-privileges): migrations apply REVOKE/GRANT hardening
 * (e.g. the column grant that stops users updating profiles.role) that a
 * restore must reproduce; anon/authenticated exist on every Supabase project.
 *
 * Restore: pg_restore -d "$DATABASE_URL" --clean --if-exists -n public <file>
 *
 * Dumps contain user data — they live outside the repo (BACKUP_DIR, default
 * /mnt/storage/spots/backups); backups/ is gitignored as a belt-and-braces.
 */
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defineCommand } from "citty";
import { consola } from "consola";
import { getEnv } from "../env.ts";
import { run } from "../lib/exec.ts";

/**
 * Refuse to back up onto the root disk when the target is a removable-drive
 * path whose drive isn't mounted — mkdirSync would otherwise silently create
 * the tree under the bare mountpoint, and the file would be shadowed (appear
 * missing) as soon as the drive mounts.
 */
function assertMounted(dir: string): void {
  if (!/^\/(mnt|media|run\/media)\//.test(dir)) return;
  let probe = dir;
  while (!existsSync(probe)) probe = dirname(probe);
  if (statSync(probe).dev === statSync("/").dev) {
    throw new Error(`${dir} resolves to the root filesystem — is the drive mounted?`);
  }
}

/** Percent-decode a URL component; tolerate literal % (e.g. raw passwords). */
function dec(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const backupCommand = defineCommand({
  meta: { name: "backup", description: "pg_dump the app data to a timestamped .dump file" },
  args: {
    dir: { type: "string", description: "Output directory (default: $BACKUP_DIR)" },
  },
  async run({ args }) {
    const env0 = getEnv();
    const dir = resolve(args.dir || env0.BACKUP_DIR);
    assertMounted(dir);
    mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
    const file = join(dir, `spots-${stamp}.dump`);
    const tmp = `${file}.tmp`;

    // Credentials go through libpq env vars, not argv — a connection string in
    // the argument list would be readable by any local process via ps//proc.
    // (libpq does NOT conninfo-expand PGDATABASE, so the URL must be split.)
    const u = new URL(env0.DATABASE_URL);
    const env = {
      ...process.env,
      PGHOST: u.hostname,
      PGPORT: u.port || "5432",
      PGUSER: dec(u.username),
      PGPASSWORD: dec(u.password),
      PGDATABASE: dec(u.pathname.replace(/^\//, "")) || "postgres",
      ...(u.searchParams.get("sslmode") ? { PGSSLMODE: u.searchParams.get("sslmode")! } : {}),
    };

    consola.info(`Dumping public schema → ${file}`);
    // Write to .tmp and rename on success so a failed run can never leave a
    // truncated file that looks like a valid backup.
    const res = await run(
      ["pg_dump", "-Fc", "--no-owner", "-n", "public", "-f", tmp],
      { env, allowNonZero: true },
    );
    const size = existsSync(tmp) ? statSync(tmp).size : 0;
    if (res.code !== 0 || size === 0) {
      rmSync(tmp, { force: true });
      consola.error(
        `pg_dump failed (exit ${res.code}${size === 0 ? ", empty output" : ""}):\n${res.stderr.trim()}`,
      );
      process.exitCode = 1;
      return;
    }
    if (res.stderr.trim()) consola.warn(res.stderr.trim());
    renameSync(tmp, file);

    consola.success(`Backup written: ${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    consola.info(`Restore with: pg_restore -d "$DATABASE_URL" --clean --if-exists -n public ${file}`);
  },
});
