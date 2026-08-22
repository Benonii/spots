/**
 * Run a hand-written .sql file against the database, in a transaction that
 * rolls back unless you ask for the commit.
 *
 * Exists so one-off data fixes don't need `psql "$DATABASE_URL"`, which puts
 * the credential in the process table for anything on the machine to read.
 * Here the URL is only ever read from the environment.
 *
 * Not a migration runner — nothing is recorded, and re-running a file runs it
 * again. Schema changes belong in packages/db/drizzle with a journal entry.
 */
import { readFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { consola } from "consola";
import { db } from "../db.ts";

/** Thrown to unwind the transaction on a dry run; never surfaces to the user. */
const ROLLBACK = Symbol("rollback");

export const sqlCommand = defineCommand({
  meta: {
    name: "sql",
    description: "Run a .sql file in a transaction (rolls back unless --commit)",
  },
  args: {
    file: { type: "positional", required: true, description: "Path to the .sql file" },
    commit: {
      type: "boolean",
      default: false,
      description: "Keep the changes. Without it the transaction is rolled back.",
    },
  },
  async run({ args }) {
    const text = await readFile(args.file, "utf8");
    if (/^\s*(begin|commit|rollback)\b/im.test(text)) {
      consola.error(
        "The file manages its own transaction (BEGIN/COMMIT/ROLLBACK). Remove those — this command wraps the file itself.",
      );
      process.exitCode = 1;
      return;
    }

    const client = (db as unknown as { $client: import("postgres").Sql }).$client;
    let sets: unknown[][] = [];
    try {
      await client.begin(async (tx) => {
        // .simple() so the whole file goes as one multi-statement query and
        // comes back as one result set per statement.
        sets = (await tx.unsafe(text).simple()) as unknown as unknown[][];
        if (!args.commit) throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }

    for (const rows of sets) {
      if (Array.isArray(rows) && rows.length) console.table(rows);
    }

    if (args.commit) {
      consola.success("Committed.");
    } else {
      consola.info(
        `Rolled back — nothing changed. The output above is what would happen. Re-run with --commit to keep it.`,
      );
    }
  },
});
