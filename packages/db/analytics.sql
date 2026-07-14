-- Product-analytics queries over the `events` table.
--
-- An "actor" is a STITCHED identity, not raw coalesce(user_id, anon_id): the
-- `linked` CTE maps every anon_id that ever co-occurred with a user_id back to
-- that user, so a person's pre-sign-in (or signed-out) events don't count them
-- twice. Events from known bot user-agents are dropped; null-UA rows (all
-- pre-0021 history) are kept. Each query repeats the same two CTEs so it stays
-- individually paste-runnable.
--
-- Run these through the RLS-bypassing CLI connection — `spots analytics` prints
-- the headline numbers, or open `bun --cwd packages/db run studio` and paste these.

-- ── DAU, last 30 days ────────────────────────────────────────────────
with linked as (
  select anon_id, min(user_id) as user_id from events
  where anon_id is not null and user_id is not null group by 1
), ev as (
  select coalesce(e.user_id, l.user_id, e.anon_id) as actor, e.created_at
  from events e left join linked l on l.anon_id = e.anon_id
  where e.created_at > now() - interval '30 days'
    and (e.user_agent is null or e.user_agent !~* 'bot|crawl|spider|slurp|headless|facebookexternalhit|whatsapp|telegram|preview|python-requests|curl/')
)
select date_trunc('day', created_at)::date as day,
       count(distinct actor) as dau,
       count(*)              as events
from ev
group by 1
order by 1 desc;

-- ── MAU (rolling 30-day active actors) ───────────────────────────────
with linked as (
  select anon_id, min(user_id) as user_id from events
  where anon_id is not null and user_id is not null group by 1
), ev as (
  select coalesce(e.user_id, l.user_id, e.anon_id) as actor,
         (e.user_id is not null or l.user_id is not null) as signed_in
  from events e left join linked l on l.anon_id = e.anon_id
  where e.created_at > now() - interval '30 days'
    and (e.user_agent is null or e.user_agent !~* 'bot|crawl|spider|slurp|headless|facebookexternalhit|whatsapp|telegram|preview|python-requests|curl/')
)
select count(distinct actor)                          as mau,
       count(distinct actor) filter (where signed_in) as signed_in_mau
from ev;

-- ── Most active days (top 5 by DAU) ──────────────────────────────────
with linked as (
  select anon_id, min(user_id) as user_id from events
  where anon_id is not null and user_id is not null group by 1
), ev as (
  select coalesce(e.user_id, l.user_id, e.anon_id) as actor, e.created_at
  from events e left join linked l on l.anon_id = e.anon_id
  where e.created_at > now() - interval '30 days'
    and (e.user_agent is null or e.user_agent !~* 'bot|crawl|spider|slurp|headless|facebookexternalhit|whatsapp|telegram|preview|python-requests|curl/')
)
select date_trunc('day', created_at)::date as day,
       count(distinct actor) as dau
from ev
group by 1
order by dau desc
limit 5;

-- ── Stickiness (avg DAU over the window / 30-day MAU) ─────────────────
with linked as (
  select anon_id, min(user_id) as user_id from events
  where anon_id is not null and user_id is not null group by 1
), ev as (
  select coalesce(e.user_id, l.user_id, e.anon_id) as actor, e.created_at
  from events e left join linked l on l.anon_id = e.anon_id
  where e.created_at > now() - interval '30 days'
    and (e.user_agent is null or e.user_agent !~* 'bot|crawl|spider|slurp|headless|facebookexternalhit|whatsapp|telegram|preview|python-requests|curl/')
), daily as (
  select date_trunc('day', created_at) as day, count(distinct actor) as dau
  from ev group by 1
)
select round(avg(dau))::int as avg_dau,
       (select count(distinct actor) from ev) as mau,
       round(100.0 * avg(dau) / nullif((select count(distinct actor) from ev), 0), 1) as stickiness_pct
from daily;

-- ── Most-used features, last 30 days ─────────────────────────────────
with linked as (
  select anon_id, min(user_id) as user_id from events
  where anon_id is not null and user_id is not null group by 1
), ev as (
  select coalesce(e.user_id, l.user_id, e.anon_id) as actor, e.name
  from events e left join linked l on l.anon_id = e.anon_id
  where e.created_at > now() - interval '30 days'
    and (e.user_agent is null or e.user_agent !~* 'bot|crawl|spider|slurp|headless|facebookexternalhit|whatsapp|telegram|preview|python-requests|curl/')
)
select name,
       count(*)              as events,
       count(distinct actor) as actors
from ev
group by name
order by events desc;

-- ── Signed-in vs anonymous split, last 30 days ───────────────────────
-- Per person: signed-in if ANY of their events link to a user_id, so nobody
-- lands in both buckets.
with linked as (
  select anon_id, min(user_id) as user_id from events
  where anon_id is not null and user_id is not null group by 1
), ev as (
  select coalesce(e.user_id, l.user_id, e.anon_id) as actor,
         (e.user_id is not null or l.user_id is not null) as signed_in
  from events e left join linked l on l.anon_id = e.anon_id
  where e.created_at > now() - interval '30 days'
    and (e.user_agent is null or e.user_agent !~* 'bot|crawl|spider|slurp|headless|facebookexternalhit|whatsapp|telegram|preview|python-requests|curl/')
)
select case when signed_in then 'signed-in' else 'anonymous' end as audience,
       count(*) as actors
from (select actor, bool_or(signed_in) as signed_in from ev group by actor) a
group by 1
order by 2 desc;

-- ── Data-quality check: how inflated is the naive count? ─────────────
with linked as (
  select anon_id, min(user_id) as user_id from events
  where anon_id is not null and user_id is not null group by 1
), ev as (
  select coalesce(e.user_id, l.user_id, e.anon_id) as actor
  from events e left join linked l on l.anon_id = e.anon_id
  where e.created_at > now() - interval '30 days'
    and (e.user_agent is null or e.user_agent !~* 'bot|crawl|spider|slurp|headless|facebookexternalhit|whatsapp|telegram|preview|python-requests|curl/')
)
select (select count(distinct coalesce(user_id, anon_id)) from events
          where created_at > now() - interval '30 days') as naive_mau,
       (select count(distinct actor) from ev)            as stitched_mau;
