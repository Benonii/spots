-- Product-analytics queries over the `events` table.
--
-- An "actor" is coalesce(user_id, anon_id): a signed-in user's stable auth id,
-- or the device's localStorage anon id. That single expression lets DAU/MAU
-- span both signed-in and anonymous visitors.
--
-- Run these through the RLS-bypassing CLI connection — `df analytics` prints the
-- headline numbers, or open `bun --cwd packages/db run studio` and paste these.

-- ── DAU, last 30 days ────────────────────────────────────────────────
select date_trunc('day', created_at)::date as day,
       count(distinct coalesce(user_id, anon_id)) as dau,
       count(*)                                   as events
from events
where created_at > now() - interval '30 days'
group by 1
order by 1 desc;

-- ── MAU (rolling 30-day active actors) ───────────────────────────────
select count(distinct coalesce(user_id, anon_id)) as mau
from events
where created_at > now() - interval '30 days';

-- ── Most active days (top 5 by DAU) ──────────────────────────────────
select date_trunc('day', created_at)::date as day,
       count(distinct coalesce(user_id, anon_id)) as dau
from events
where created_at > now() - interval '30 days'
group by 1
order by dau desc
limit 5;

-- ── Stickiness (avg DAU over the window / 30-day MAU) ─────────────────
with daily as (
  select date_trunc('day', created_at) as day,
         count(distinct coalesce(user_id, anon_id)) as dau
  from events
  where created_at > now() - interval '30 days'
  group by 1
)
select
  round(avg(dau))::int as avg_dau,
  (select count(distinct coalesce(user_id, anon_id)) from events
     where created_at > now() - interval '30 days')                      as mau,
  round(
    100.0 * avg(dau)
    / nullif((select count(distinct coalesce(user_id, anon_id)) from events
                where created_at > now() - interval '30 days'), 0)
  , 1) as stickiness_pct
from daily;

-- ── Most-used features, last 30 days ─────────────────────────────────
select name,
       count(*)                                    as events,
       count(distinct coalesce(user_id, anon_id))  as actors
from events
where created_at > now() - interval '30 days'
group by name
order by events desc;

-- ── Signed-in vs anonymous split, last 30 days ───────────────────────
select case when user_id is null then 'anonymous' else 'signed-in' end as audience,
       count(distinct coalesce(user_id, anon_id)) as actors,
       count(*)                                   as events
from events
where created_at > now() - interval '30 days'
group by 1
order by 2 desc;
