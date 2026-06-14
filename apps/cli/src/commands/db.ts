/**
 * Drizzle-kit passthroughs so day-to-day runs don't need to remember the config
 * path. They shell out to drizzle-kit inside packages/db.
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { fileURLToPath } from "node:url";

const dbDir = fileURLToPath(new URL("../../../../packages/db", import.meta.url));

async function drizzle(...drizzleArgs: string[]) {
  const proc = Bun.spawn(["bunx", "drizzle-kit", ...drizzleArgs], {
    cwd: dbDir,
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
  });
  const code = await proc.exited;
  if (code !== 0) {
    consola.error(`drizzle-kit ${drizzleArgs.join(" ")} exited ${code}`);
    process.exitCode = code;
  }
}

export const migrateCommand = defineCommand({
  meta: { name: "migrate", description: "Apply pending migrations (drizzle-kit migrate)" },
  run: () => drizzle("migrate"),
});

export const generateCommand = defineCommand({
  meta: { name: "generate", description: "Generate a migration from schema (drizzle-kit generate)" },
  run: () => drizzle("generate"),
});

export const pushCommand = defineCommand({
  meta: { name: "push", description: "Push schema directly — dev only (drizzle-kit push)" },
  run: () => drizzle("push"),
});
