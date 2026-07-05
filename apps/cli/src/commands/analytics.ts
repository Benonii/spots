/**
 * `spots analytics` — headline product metrics from the `events` table, read over
 * the RLS-bypassing CLI connection. For ad-hoc digging see packages/db/analytics.sql.
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { sql } from "drizzle-orm";
import { db } from "../db.ts";

export const analyticsCommand = defineCommand({
  meta: { name: "analytics", description: "DAU/MAU and most-used features from the events table" },
  args: {
    days: { type: "string", description: "Look-back window in days (default 30)", default: "30" },
  },
  run: async ({ args }) => {
    const days = Number(args.days) || 30;
    const since = sql.raw(`now() - interval '${days} days'`);
    const actor = sql`coalesce(user_id, anon_id)`;

    // One distinct-actor count per active day, reused for the average and the
    // most-active-days list below. Averaging over active days (not all calendar
    // days) avoids understating a freshly-launched app whose window has empty days.
    const daily = (await db.execute(sql`
      select date_trunc('day', created_at) as day,
             count(distinct ${actor})       as actors
      from events
      where created_at > ${since}
      group by 1
      order by day
    `)) as unknown as { day: string; actors: number }[];

    const avgDau = daily.length
      ? Math.round(daily.reduce((s, d) => s + Number(d.actors), 0) / daily.length)
      : 0;

    const rows = (await db.execute(sql`
      select
        (select count(distinct ${actor}) from events
           where created_at > ${since})                         as mau,
        (select count(*) from events where created_at > ${since}) as events
    `)) as unknown as { mau: number; events: number }[];
    const totals = rows[0] ?? { mau: 0, events: 0 };

    const stickiness = totals.mau ? ((avgDau / totals.mau) * 100).toFixed(1) : "0";
    consola.box(
      [
        `Window:        last ${days} days`,
        `Avg DAU:       ${avgDau}  (mean over ${daily.length} active day${daily.length === 1 ? "" : "s"})`,
        `MAU:           ${totals.mau}`,
        `Stickiness:    ${stickiness}%  (avg DAU/MAU)`,
        `Events:        ${totals.events}`,
      ].join("\n"),
    );

    const topDays = [...daily].sort((a, b) => Number(b.actors) - Number(a.actors)).slice(0, 5);
    if (topDays.length) {
      consola.info("Most active days");
      for (const d of topDays) {
        const label = new Date(d.day).toISOString().slice(0, 10);
        consola.log(`  ${label}   ${d.actors} active user${Number(d.actors) === 1 ? "" : "s"}`);
      }
    }

    const features = (await db.execute(sql`
      select name,
             count(*)                 as events,
             count(distinct ${actor}) as actors
      from events
      where created_at > ${since}
      group by name
      order by events desc
      limit 20
    `)) as unknown as { name: string; events: number; actors: number }[];

    if (features.length) {
      consola.info("Most-used features");
      for (const f of features) {
        consola.log(`  ${f.name.padEnd(20)} ${String(f.events).padStart(7)} events   ${f.actors} actors`);
      }
    } else {
      consola.info("No events recorded yet in this window.");
    }

    const audience = (await db.execute(sql`
      select case when user_id is null then 'anonymous' else 'signed-in' end as audience,
             count(distinct ${actor}) as actors
      from events
      where created_at > ${since}
      group by 1
      order by 2 desc
    `)) as unknown as { audience: string; actors: number }[];

    if (audience.length) {
      consola.info("Audience");
      for (const a of audience) consola.log(`  ${a.audience.padEnd(12)} ${a.actors} actors`);
    }
  },
});
