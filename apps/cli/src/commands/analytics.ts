/**
 * `spots analytics` — headline product metrics from the `events` table, read over
 * the RLS-bypassing CLI connection. For ad-hoc digging see packages/db/analytics.sql.
 *
 * Two accuracy fixes over naive coalesce(user_id, anon_id) counting (which
 * inflated MAU ~8x — most "actors" were one-hit anonymous ids):
 *  - identity stitching: an anon_id that ever co-occurred with a user_id is that
 *    user, so pre-sign-in / signed-out events don't mint a second actor.
 *  - bot filtering: events whose user_agent matches known crawlers/preview
 *    fetchers are dropped (rows with null UA — all pre-0021 history — are kept).
 */
import { defineCommand } from "citty";
import { consola } from "consola";
import { sql } from "drizzle-orm";
import { db } from "../db.ts";

const BOT_UA = "bot|crawl|spider|slurp|headless|facebookexternalhit|whatsapp|telegram|preview|python-requests|curl/";

export const analyticsCommand = defineCommand({
  meta: { name: "analytics", description: "DAU/MAU and most-used features from the events table" },
  args: {
    days: { type: "string", description: "Look-back window in days (default 30)", default: "30" },
  },
  run: async ({ args }) => {
    const days = Number(args.days) || 30;
    const since = sql.raw(`now() - interval '${days} days'`);

    // Shared CTE: `ev` is the window's events with a stitched actor id and bots
    // removed. Every query below reads from it so the numbers always agree.
    const ev = sql`
      with linked as (
        select anon_id, min(user_id) as user_id
        from events
        where anon_id is not null and user_id is not null
        group by 1
      ),
      ev as (
        select coalesce(e.user_id, l.user_id, e.anon_id) as actor,
               (e.user_id is not null or l.user_id is not null) as signed_in,
               e.name, e.created_at
        from events e
        left join linked l on l.anon_id = e.anon_id
        where e.created_at > ${since}
          and (e.user_agent is null or e.user_agent !~* ${BOT_UA})
      )
    `;

    // One distinct-actor count per active day, reused for the average and the
    // most-active-days list below. Averaging over active days (not all calendar
    // days) avoids understating a freshly-launched app whose window has empty days.
    const daily = (await db.execute(sql`
      ${ev}
      select date_trunc('day', created_at) as day,
             count(distinct actor)          as actors
      from ev
      group by 1
      order by day
    `)) as unknown as { day: string; actors: number }[];

    const avgDau = daily.length
      ? Math.round(daily.reduce((s, d) => s + Number(d.actors), 0) / daily.length)
      : 0;

    const rows = (await db.execute(sql`
      ${ev}
      select count(distinct actor)                            as mau,
             count(distinct actor) filter (where signed_in)   as signed_in_mau,
             count(*)                                         as events
      from ev
    `)) as unknown as { mau: number; signed_in_mau: number; events: number }[];
    const totals = rows[0] ?? { mau: 0, signed_in_mau: 0, events: 0 };

    const stickiness = totals.mau ? ((avgDau / totals.mau) * 100).toFixed(1) : "0";
    consola.box(
      [
        `Window:        last ${days} days`,
        `Avg DAU:       ${avgDau}  (mean over ${daily.length} active day${daily.length === 1 ? "" : "s"})`,
        `MAU:           ${totals.mau}  (${totals.signed_in_mau} signed in)`,
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
      ${ev}
      select name,
             count(*)              as events,
             count(distinct actor) as actors
      from ev
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

    // Stitched: a person is "signed-in" if ANY of their events link to a user_id,
    // so nobody appears in both buckets.
    const audience = (await db.execute(sql`
      ${ev}
      select case when signed_in then 'signed-in' else 'anonymous' end as audience,
             count(*) as actors
      from (select actor, bool_or(signed_in) as signed_in from ev group by actor) a
      group by 1
      order by 2 desc
    `)) as unknown as { audience: string; actors: number }[];

    if (audience.length) {
      consola.info("Audience");
      for (const a of audience) consola.log(`  ${a.audience.padEnd(12)} ${a.actors} actors`);
    }
  },
});
