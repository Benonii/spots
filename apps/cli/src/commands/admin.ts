/**
 * Curation-role management (CLI = god mode, bypasses RLS + the column lock).
 *
 * This is how the FIRST super-admin is bootstrapped — the web `set_role()` path
 * is super-gated, so there has to be a way in from outside RLS. Day-to-day, supers
 * grant/revoke other admins from the web; this stays for bootstrap and recovery.
 *
 * A target must have signed in at least once (so a row exists in auth.users); we
 * write their role onto profiles, creating the profile row if the sign-in handler
 * hasn't yet.
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db.ts";

/** Resolve an email to its auth.users id (null if they've never signed in). */
async function findUserId(email: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    select id::text as id from auth.users where lower(email) = lower(${email}) limit 1
  `)) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

const grant = defineCommand({
  meta: { name: "grant", description: "Grant admin (or --super) to a user by email" },
  args: {
    email: { type: "positional", description: "User email (must have signed in once)", required: true },
    super: { type: "boolean", description: "Grant super-admin instead of admin", default: false },
  },
  async run({ args }) {
    const role = args.super ? "super" : "admin";
    const id = await findUserId(args.email);
    if (!id) {
      consola.error(`No account for ${args.email}. They must sign in once first.`);
      process.exitCode = 1;
      return;
    }
    await db
      .insert(schema.profiles)
      .values({ id, role })
      .onConflictDoUpdate({
        target: schema.profiles.id,
        set: { role, updatedAt: new Date() },
      });
    consola.success(`${args.email} is now ${role}.`);
  },
});

const revoke = defineCommand({
  meta: { name: "revoke", description: "Revoke a user's role back to plain user" },
  args: {
    email: { type: "positional", description: "User email", required: true },
  },
  async run({ args }) {
    const id = await findUserId(args.email);
    if (!id) {
      consola.error(`No account for ${args.email}.`);
      process.exitCode = 1;
      return;
    }
    const [row] = await db
      .update(schema.profiles)
      .set({ role: "user", updatedAt: new Date() })
      .where(eq(schema.profiles.id, id))
      .returning({ id: schema.profiles.id });
    if (row) consola.success(`${args.email} is now a regular user.`);
    else consola.warn(`${args.email} had no profile — nothing to revoke.`);
  },
});

const list = defineCommand({
  meta: { name: "list", description: "List all admins and supers" },
  async run() {
    const rows = (await db.execute(sql`
      select u.email, p.role, p.display_name
      from public.profiles p
      join auth.users u on u.id::text = p.id
      where p.role in ('admin','super')
      order by p.role desc, u.email
    `)) as unknown as { email: string; role: string; display_name: string | null }[];
    if (!rows.length) {
      consola.info("No admins yet. Bootstrap one: spots admin grant <email> --super");
      return;
    }
    for (const r of rows) {
      const name = r.display_name ? `  (${r.display_name})` : "";
      consola.log(`${r.role.padEnd(6)} ${r.email}${name}`);
    }
  },
});

export const adminCommand = defineCommand({
  meta: { name: "admin", description: "Manage curation roles (grant/revoke/list)" },
  subCommands: { grant, revoke, list },
});
