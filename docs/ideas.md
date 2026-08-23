# Ideas

Staging ground for features that aren't committed yet. Each one gets shaped here
— what it actually is, the shape that fits spots, what makes it unreliable, and
where the v1 cut line falls — and is promoted to the roadmap only once its
"promote when" gate is met.

Follows the same convention as `architecture.md` §2: once a call is made here,
it isn't re-litigated mid-build.

---

## 0. Where we actually are

Numbers pulled from prod on 2026-08-13. They reorder the priorities below, so
they come first.

| | |
|---|---|
| Spots in catalog | 386 (345 scraped, 41 manual, 0 hidden) |
| Tagged `activity` | **2** |
| Tagged `event` | 12 — and several already happened |
| Tracked channels | 9, **all food review** |
| Last successful scrape | **2026-07-20** — and none possible since (see P0) |
| Source videos | 794 scraped, 470 became spots (59% yield) |
| MAU — signed-in | **22** |
| MAU — all actors (incl. anonymous devices) | 262 after identity stitching + bot filtering |
| Avg DAU / stickiness | 15 / 5.7% — both all-actor figures (15 ÷ 262) |
| Profiles ever created | 67 |
| Users who've saved a spot / logged a visit | 15 / 8 |

The two MAU figures measure different populations and shouldn't be divided into
each other. 22 is people we can name; 262 counts anonymous devices, most of which
fired a single event and never returned. Treat 22 as the real base and 262 as an
upper bound — see the analytics accuracy work of 2026-08-13 for why the raw
number was higher still.

Three things fall out of this, and they change what "fix MAU" means:

**The catalog stopped growing on 2026-07-20.** That is the single largest
correlate of the MAU decline. A discovery app with no new inventory has no reason
to be reopened — you browse 386 spots once and you're done. Two distinct causes,
established on 2026-08-13/14: nobody ran ingest between Jul 20 and Aug 10, and
from Aug 10 onward TikTok scraping has been **broken upstream** and cannot be run
at all (see P0). The second cause is not fixable from this repo. The "New" category
chip (`isNewSpot`, 7-day window) has been rendering an empty set for over two
weeks, so the one surface that advertises freshness is silently dead.

**The activity gap is a sourcing gap, not a feature gap.** All 9 channels review
restaurants and cafés, so the catalog is 99% food by construction. Both
`activity` spots came in manually via `@me_says`, not from the pipeline. No
amount of UI work creates activity content; only new sources do.

**Events are already leaking into `spots` and rotting there.** "Addis open air
cinema", "4 Kilo Plaza food bazaar", "Urban Addis Jazz Night", "IFest Events"
are all one-off happenings from June sitting in the catalog as though they were
permanent venues. This is a live data-quality bug today, independent of whether
we ever build an events view.

Also worth noting: `@sheger.bites7`'s newest video is from 2025-11-13 (the
channel is dormant but still scraped every run) and `@mels_pov` was missed by the
last run entirely (last scraped 2026-07-06).

---

## P0 — Ingestion cadence

**Verdict: do this first.** Cheapest item here and the one the data points at.
Every idea below decays into a one-time bump without it — you add events, get a
spike, then the same flat line three weeks later.

### Incident: the TikTok outage of 2026-08-10 → 08-17 (RESOLVED)

Kept because the failure mode will recur and the diagnosis cost a day.

For a week, all TikTok scraping was dead: profile enumeration returned `403` and
video extraction failed outright, across yt-dlp *and* gallery-dl *and* raw curl.
The profile page served a ~1.4 KB `SlardarWAF` (`slardar_us_waf`) JavaScript stub
instead of content, which made it look like an unsolvable WAF challenge. That
reading was wrong.

**Actual cause: a missing `Referer` header.** TikTok's Akamai layer rejects
requests without one. The fix is one flag — `--referer https://www.tiktok.com/` —
now baked into `apps/cli/src/lib/ytdlp.ts` for both `enumerateChannel` and
`fetchVideo`. Credit to yt-dlp [PR #17437](https://github.com/yt-dlp/yt-dlp/pull/17437);
tracked upstream as [#17403](https://github.com/yt-dlp/yt-dlp/issues/17403).
Verified 2026-08-17: 660 videos enumerated, metadata fetched, newest post
same-day.

Things that were tried and did **not** work, so nobody burns a day re-trying
them: browser-UA spoofing, TLS impersonation (`--impersonate`, every target),
downgrading yt-dlp to `2026.03.17`, anonymous TikTok cookies including
`_waftokenid`/`ttwid`, and a fully logged-in session (115 cookies incl.
`sessionid`/`sid_guard`). All returned the same `403` — because all of them still
omitted the Referer.

Three lessons worth keeping:

1. **A WAF-looking stub is not proof of a WAF challenge.** The whole week was
   lost to pattern-matching the symptom instead of diffing our request against a
   working browser request. Diff the request first.
2. **The outage was invisible.** The pipeline was dead for five days and nothing
   surfaced it — exactly the pull-based-guard weakness flagged below. This is now
   a demonstrated failure, not a hypothetical one.
3. **`gallery-dl` is a genuine fallback.** It parses the rehydration blob itself
   and only uses yt-dlp for media files, so it survives yt-dlp extractor breakage.
   It fetched full metadata (a superset of what `mapVideo()` consumes) throughout
   the outage. Worth remembering next time, though it 403s on profiles too.

### The plan

**Why it's broken:** ingestion is manual by design.
`architecture.md` §2 chose batch-not-realtime and local-IP-only, because TikTok
blocks datacenter and CI IPs and yt-dlp needs a residential Addis IP. That
decision is still correct. What was missing is that "manual" has no cadence, so
runs happened when someone remembered. Note the staleness had **two** causes:
Jul 20 → Aug 10 nobody ran it, and Aug 10 → Aug 17 it was broken upstream
(resolved above). Cadence fixes the first cause; item 5 below is what would have
caught the second.

**The shape that fits:** keep it local, remove the remembering.

1. A systemd user timer on the Manjaro box running `spots backup && spots ingest`
   weekly. Not a GitHub Action — that reintroduces the datacenter-IP problem the
   architecture doc explicitly avoided. Backup first, matching the documented
   practice in the backup command's own header.
2. **Bound the run.** This is the part that must not be skipped. `--limit` only
   bounds the *scrape* stage; the metered stages downstream (ScrapFly comments,
   LLM normalize, Places geocode) then chew through the entire backlog
   unbounded — the CLI warns about exactly this. An unattended weekly job with no
   `--min-views` is the one way this item can cost real money. Pin both flags in
   the timer's command line and review the spend after the first two runs.
3. A freshness guard: the run reports spots added, and warns when a tracked
   channel has produced nothing in 30 days (would have caught both
   `@sheger.bites7` being dormant and `@mels_pov` being skipped).
4. Surface freshness in the product. The `New` chip already exists and already
   decays on its own — it just needs a non-empty set behind it. Once weekly runs
   are real, this becomes the return-visit hook for free.
5. **A `spots doctor` command** that probes the pipeline end-to-end — enumerate
   one channel, fetch one video — and exits non-zero when scraping is broken.
   Promoted from nice-to-have by the August outage: the pipeline was dead five
   days and nothing said so. Cheap (the probe is ~20 lines), and it converts the
   next breakage from "notice the catalog looks stale weeks later" into "the
   timer emailed a failure." Pair it with a push on failure so the signal isn't
   pull-based.

**Reliability risk:** an unattended run that half-fails and leaves the catalog in
a worse state. Mitigated by what already exists — every stage is idempotent, reads
its work-list from the DB, and stamps its timestamp even on failure so a re-run
never re-spends on the same video. A partial run is resumable rather than
corrupting. Add a summary line to the existing analytics surface so a silent
failure is visible without reading logs.

**Caveat on that guard: it's pull-based.** It surfaces in `spots analytics`,
which only helps if somebody runs it — a timer that dies quietly would recreate
the exact 24-day staleness this section opens with. Good enough to start;
a push notification on a failed or empty run is the obvious follow-up.

**Effort:** half a day to a day.

**Promote when:** immediately.

---

## 1. Events & activities

The original idea bundles two different things with different data shapes,
different failure modes, and different effort. Splitting them is most of the
work of making this reliable.

### 1a. Activities — permanent places we simply don't have

Bowling, museums, karting, paintball, tennis, hiking, pottery, spas, cinemas.
These are **spots**, not events: they have a location, opening hours, a price
range, and they don't expire. They fit the existing model exactly.

**Verdict: do it. Highest value-per-unit-effort of anything on this list**,
because it reuses the entire pipeline and view layer already built.

**The shape:**

1. **Find activity-oriented sources.** This is the actual work, and it's
   research, not engineering. Candidate types: "things to do in Addis" TikTok
   accounts, lifestyle/vlog channels that aren't food-first, and the event
   channels in §1b (which cover recurring venues alongside one-off events).
2. **Add a `kind` discriminator to `spots`** (`'food' | 'activity'`). Without it,
   activities are second-class: the five quality dimensions are
   aesthetic/vibe/**food**/value/service, and scoring a tennis court on "food"
   produces noise that feeds straight into `quality_score`. `kind` lets the
   extraction prompt score the right dimensions and lets the UI split browse.
3. **Seed manually while sourcing catches up.** 41 spots are already `source:
   "manual"` and the admin editor supports the full flow — so a curated list of
   30 known Addis activities can be in the catalog this week, without waiting for
   any scraper work. Do this in parallel; it de-risks the whole item.

**Reliability risks:**

- The LLM extraction schema is food-shaped, so activity captions produce
  low-confidence garbage until the prompt is kind-aware. Mitigate by making
  `kind` an extraction output and routing non-food kinds through a different
  dimension set.
- **Don't retrofit `kind` with `normalize --all`.** That flag re-bills an LLM
  completion for every row in `source_videos` (794 today) — it exists for prompt
  re-tuning and it's the single easiest way to spike the bill. Set `kind` on new
  videos going forward and backfill the existing catalog with a cheap
  tag-based heuristic (the `activity`/`event` tags already mark most of them),
  reserving a real re-normalize for when the prompt change justifies it.
- **`kind` needs an upsert lock key.** Every `upsert` re-aggregates a place from
  all its videos and overwrites scrape-owned columns; without adding `kind` to
  the locked-fields mechanism, an admin correcting a misclassified spot will see
  it silently revert on the next run.

**v1 cut line:** `kind` column + 30 manually-seeded activities + one activity
source in the pipeline. Ship the browse split only once there are enough to fill
it — a category chip that yields four results is worse than no chip.

**Effort:** 1 day of engineering, plus ongoing curation.

**Promote when:** P0 is done (a new source is worthless on a pipeline that
doesn't run).

### 1b. Events — genuinely a new content type

Concerts, festivals, pop-ups, screenings, exhibitions. Time-bound, expire, and
worthless the day after.

**Verdict: do it — this is the strongest MAU lever on the list.** It's the only
feature here that gives someone a reason to open the app *weekly* rather than
once. But it's also the largest build, so it goes after P0 and 1a.

**Source viability — checked, and it's better than expected.**

`t.me/s/LinkUpAddis` (25.4K subscribers) serves a **public HTML preview page —
no API key, no auth, no bot membership, and none of TikTok's rate-limit
hostility.** Pagination works via `?before=<message_id>`. Posts carry exactly the
fields we need, in English, with explicit Gregorian dates. Verbatim samples
pulled 2026-08-13:

> "Static III is pulling up to Anki Liquor on 29 August… starting from 7 PM. Lock
> in your ticket for only 700 ETB"

> "The Threads of Addis Pop-Up Event (Kiremt Edition)… Saturday, 15 August 2026,
> from 10:00 AM to 6:00 PM at HANUBET"

This makes it the most reliable source in the entire system — more reliable than
the TikTok pipeline. `@EventInAddis` and `@eventaddis1` are secondary channels
worth adding for coverage and cross-checking.

**The shape:**

1. **A new table — and it cannot be called `events`.** That name is taken by the
   analytics stream (insert-only, no select policy), so a product table of that
   name would be unqueryable by design. Proposed: `happenings`.
2. **Telegram poller** in the CLI, mirroring the existing stage pattern
   (idempotent, work-list from DB, dedup by message id).
3. **LLM extraction** to `{ title, venue, starts_at, ends_at, price, ticket_url,
   confidence }`, reusing the existing `generateObject` + Zod setup. Pass today's
   date into the prompt so relative dates ("this Saturday", "ነገ") resolve.
4. **Optional link to a spot** via `google_place_id` when the venue is already in
   the catalog — that's what makes this *ours* rather than a Telegram mirror.
   "Jazz night at a place you already saved" is the thing no other channel can do.
5. **A dedicated `/happenings` route**, lazy-loaded exactly like `/near`. Default
   filter is `starts_at >= now()` — expiry is a query predicate, so an event can
   never be shown after it's passed. This is the correctness property the whole
   feature rests on.

**Reliability risks, in order of severity:**

- **A wrong date shows an expired or phantom event.** This is the one failure
  that discredits the feature. Two mitigations: extraction returns a
  `confidence`, and low-confidence rows land in an **admin review queue** rather
  than going live. Volume is a handful per week, so human review is genuinely
  tractable here — this is not a scale problem.
- **Never show undated events.** If `starts_at` can't be extracted, the row does
  not publish. A missing event costs nothing; a wrong one costs trust.
- **Ethiopian calendar dates and relative phrasing.** Every post in the (small —
  roughly five posts) sample used an explicit Gregorian date, which is
  encouraging but is not enough to call it the norm. Assume some fraction needs
  calendar conversion or relative-date resolution until a larger sample says
  otherwise. The mitigations above already cover this case, so a worse ratio
  costs review time rather than correctness.
- **Source dependency.** If LinkUp Addis changes format or goes private, the
  feature starves. Secondary channels are the hedge.
- **Don't let Telegram rows leak into the TikTok stages.** `source_videos` can be
  reused for Telegram (set `channels.platform = 'telegram'`, namespace the id as
  `tg:<chat>:<msg>`), and that's tempting because the scrape/normalize scaffolding
  is already there. But the `comments`, `normalize` and `geocode` work-lists have
  **no platform predicate today** — they select on nullable timestamps alone. Reuse
  the table and Telegram rows get swept into ScrapFly (which only speaks TikTok's
  comment API) and into the TikTok-specific extraction prompt. Add the platform
  filter to all three work-lists *before* inserting the first Telegram row, or
  give events their own source table. Also note `spots channels add` has no
  `--platform` flag — `platform` silently defaults to `tiktok`.

**v1 cut line:** poller + `happenings` + review queue + a list view sorted by
date, filtered to future-only. No map, no categories, no search. Ship the
smallest thing that is *correct*, then add filters once there's volume to filter.

**Also do, independently and cheaply:** the 12 event-tagged spots polluting
`spots` should be triaged now — expired ones hidden, permanent venues (Mamata
Events, Etege Hotels) retagged. That's a data cleanup worth doing regardless of
whether §1b ever ships.

**Monetization** (tickets/booking) is real, but it rides on §4's rails — don't
scope it here.

**Effort:** ~5 days (poller 1, schema+extraction 1, review queue 1, view 2).

**Promote when:** P0 and 1a are done.

---

## 2. User-submitted channels

**Verdict: do it, but it's small and it sequences late.** Correctly framed it's
not really a content-sourcing feature — the submission rate from 22 active users
will be a trickle. It's a **trust and community** feature: showing which channels
we source from is a credibility statement ("this is curated from people you
already follow"), and the submission box is what makes users feel like
participants.

Judge it on that, not on how many channels it adds.

**The shape:** the write path can't touch `channels` — that table has RLS on with
no policies at all, deliberately, so only the CLI connection reaches it. So:

1. A new insert-only table modelled exactly on `feedback` (anon + authenticated
   insert, no select policy, length check, `user_id` defaulted from `auth.uid()`).
2. A submission form cloned from `FeedbackModal` — same shape, same anon-allowed
   insert, focus trap and status states already solved there.
3. A public "where our spots come from" list. This is the half that carries the
   actual value; it needs no new table, only the handles.
4. Admin review promotes a submission into `channels` — either a
   `SECURITY DEFINER` RPC gated on `is_admin()`, or just the CLI. Start with the
   CLI; there's no volume justifying UI yet.

**Reliability risk:** low. Spam is the only real one, and admin review plus the
existing rate of traffic makes it a non-issue at this size.

**Effort:** ~1 day.

**Promote when:** after §1. It only pays off on a pipeline that runs
automatically — otherwise approved channels sit unscraped and the loop is
visibly broken to the person who submitted.

---

## 3. Calorie estimates

**Verdict: don't build this as specified. Build a much narrower version, or
nothing.**

The request was "average calorie per restaurant + a calorie filter", conditioned
on it being reliable. It isn't, for three independent reasons:

1. **The input doesn't exist.** Menus for Addis restaurants are rarely online in
   any parseable form, and there is no menu source anywhere in the codebase to
   build on. Google Places could theoretically help, but the geocode call
   requests a deliberately minimal field mask — widening it moves the call into a
   more expensive Places SKU tier, so "just ask Places for menus" has a per-call
   price attached and still wouldn't return calorie data. The pipeline's actual
   input is TikTok captions and comments, which describe vibes and prices, not
   portions or preparation.
2. **The output is close to meaningless even if the input existed.** "Average
   calories for this restaurant" averages over a menu — a café serving both a
   salad and a cheesecake has an average that describes neither. It's not a
   property of a restaurant.
3. **It's a health claim.** A wrong number here is worse than a missing one, in a
   way that a wrong price or tag isn't. People with medical reasons to count will
   act on it.

**The narrow version that is defensible:** rough intensity bands rather than
numbers — `light` / `moderate` / `heavy` — inferred from what the video and
comments actually describe, surfaced as an "eat light" filter. That's honest
about its own precision, costs nothing extra (the LLM already reads this text),
and probably serves the underlying want, which is likely "where can I go that
isn't heavy" rather than "give me a kcal figure".

If the bands version does get built, it's a **new billed LLM unit** and must
follow the pattern the pipeline already uses for every metered stage: a nullable
timestamp column stamped even when estimation fails (so a re-run never re-spends
on the same row), a partial index for the work-list, and — if the value lands on
`spots` — a lock key so `upsert` doesn't recompute it every run.

**Before building even that, ask the requester what they'd do with the number.**
If the answer is "avoid heavy food", bands solve it. If the answer is "track my
intake", nothing we can build from TikTok captions will serve them and we should
say so rather than ship a number they'll trust.

**Effort:** ~1 day for bands. Zero for the honest "no".

**Promote when:** never, as specified. Bands version is a nice-to-have that can
ride along with any other extraction-prompt change.

---

## 4. Delivery, ordering & reservations

**Verdict: build reservations. Do not build delivery.**

**Why not delivery:** own-delivery is a logistics company — couriers, dispatch,
payments, support, refunds, insurance. That is not an extension of spots, it is a
replacement for it, and it competes head-on with
[beU](https://beudelivery.com/), [Deliver Addis](https://deliveraddis.com/) and
[ZMall](https://play.google.com/store/apps/details?id=com.zmall.user), all of
whom have couriers on the road today. If delivery ever appears in spots, it
should be a deep link into one of them, not a fleet.

**Why reservations:** it's the natural next verb after discovery. Someone found a
spot, saved it, and now wants to go — "book a table" is one step, not a new
product. It needs no couriers, no inventory, and no payment rails to start. And
it's the honest first step toward revenue.

**The shape that fits Addis — Telegram, not a dashboard:**

The instinct is to build a vendor dashboard so venues can see bookings. Don't,
not for v1. Addis businesses already live on Telegram. A bot that messages the
venue "Table for 2, Saturday 8pm — Accept / Decline" gets the same job done with
roughly a tenth of the product surface, and it works on the phone the manager is
already holding. Build the dashboard when a venue asks for one.

1. **Pilot manually with 3–5 venues.** No integration at all — a "Request a
   table" button that opens a form, and you relay it by hand. This answers the
   only question that matters (do people request, do venues honour it) for
   roughly zero engineering.
2. **If the pilot works,** add the Telegram bot for venue notification and
   accept/decline.
3. **Payments last**, and only if pre-payment or deposits turn out to be needed.
   [Chapa](https://chapa.co/) is the developer-friendly option (API-first,
   startup-oriented); [Telebirr](https://en.wikipedia.org/wiki/Telebirr) has
   vastly more volume; [SantimPay](https://santimpay.com/) and ArifPay are the
   other credible local gateways. Verify current fees and settlement terms before
   committing scope — none of this should be assumed from a search result.

**Reliability risk — this is the one that differs in kind from everything above.**
Every other feature fails in software. This one fails in the real world: someone
shows up and there is no table. That damages trust in the whole app, not just the
feature. Which is exactly why the pilot is manual and small — the failure mode
has to be understood at 5 venues before it's automated at 50.

**Effort:** ~0 for the manual pilot. 3–5 days for the bot version.

**Promote when:** MAU is recovering. Monetizing a shrinking audience is the wrong
order — the pilot needs enough weekly actives that 3–5 venues see real volume.

---

## 5. Sharing

Three things could be shareable — a spot, the "want to go" list, and "Places
we've been". They look like one feature and are three, so they're split here.

**Shipped: individual spots.** A share button on the card, copying
`/?spot=<place_id>` — the deep link the carousel already honours for `/near`.
Generic OG card, deliberately: dynamic per-spot preview images need a Vercel
function serving per-route meta, since this is a SPA with a blanket rewrite to
`index.html` and Telegram/WhatsApp scrapers don't run JS. Every shared link
therefore previews as the site, not the spot. Called acceptable for v1.

**Parked: "want to go".** There is no list entity — `saved_spots` is per-row
bookmarks under owner-scoped RLS, so "my list" is just "all my rows". Sharing it
means inventing the entity: either a `share_token` on profiles plus a security
definer RPC (revocable, identity-free) or a `saved_public` flag plus a select
policy (simpler, but on/off for your identity rather than a link you can
retract). Not started.

**Parked: invite-based "Places we've been".** The idea: invite a specific email,
generate a token URL, they sign up, they see your log.

The finding that stalled it — **an invite gate currently gates nothing.**
`public read visits` is `to: authenticatedRole, using: true`, so any signed-in
user already reads every visit log; that's what the community feed on the home
page renders. So the feature is one of:

- *Invite as onboarding link* — token URL → landing page → Google sign-in →
  email matches → lands on the inviter's log. Visibility unchanged, since the
  invitee signs up before seeing anything. One table, two security definer RPCs
  (RLS can't evaluate a URL token), no policy rewrite.
- *Visit logs actually go private* — rewrite the visits select policy around a
  grants table. **This kills the community feed**, which is built on everyone
  reading everyone. Matches survives either way; it runs on `saved_spots`
  (`my_matches()`, migration 0020), not visits.

Unresolved, and the reason it's parked: whether it's fine that any signed-in
user can browse every user's visit log today. That's a product call, not a
technical one.

Two mechanics already decided, should it resume: bind the invite to an email
rather than *sending* mail (no email infrastructure exists; the inviter sends
the link over Telegram/WhatsApp, which is where sharing happens here anyway),
and refuse a mismatched sign-in with "this invite was sent to a@b.com" rather
than silently claiming it.

**Promote when:** there's a reason to believe sharing drives signups — the spot
share button is the cheap experiment that tells us.

---

## Sequencing

Ordered by (MAU impact) ÷ (effort × risk), not by ambition. **Restored
2026-08-17** after the TikTok outage resolved — the Aug 14 emergency ordering
(which led with the two TikTok-independent items) no longer applies.

| # | Item | Effort | Why here |
|---|---|---|---|
| 1 | **Ingestion cadence + `spots doctor`** | ~1 day | The measured cause of the decline, and now unblocked. The outage proved the monitoring half isn't optional. |
| 2 | **Activities** (`kind` + manual seed + a source) | ~1 day + curation | Reuses the whole existing stack; fills the most obvious content hole. Sourcing works again, so the channel half is live too. |
| 3 | **Events** (`happenings` + Telegram + `/happenings`) | ~5 days | Biggest build, biggest payoff — the only weekly-return reason here. Growing more urgent: every ingest adds more expired events to `spots`. |
| 4 | **Channel submissions** | ~1 day | Trust/community. Needs #1 to be real first. |
| 5 | **Reservations pilot** | ~0 (manual) | Revenue path, but needs an audience to be worth monetizing. |

Not sequenced: calorie estimates (see §3 — narrow version rides along with any
extraction change, full version doesn't get built).

---

## Decisions this file commits to

Same spirit as `architecture.md` §2 — recorded so they don't get relitigated.

| Decision | Rationale |
|---|---|
| Events live in `happenings`, not `spots` | Different lifecycle (they expire) and `events` is already the analytics table. Mixing them is the bug we have today. |
| Undated events never publish | A missing event costs nothing; a wrong one costs trust in the catalog. |
| Ingestion stays local + scheduled, not CI | Preserves the residential-IP decision in `architecture.md` §2; only removes the human trigger. |
| No browser automation to defeat TikTok anti-scraping | Playwright would work, but it's a permanent maintenance race against an anti-scraping team. Fix the request instead — the Aug 2026 outage turned out to be one missing header. |
| Scheduled ingest ships with a health probe, not without one | A timer against a broken pipeline fails silently and is indistinguishable from the staleness it was meant to prevent. Aug 2026 proved this: five days dead, nothing surfaced it. |
| Diff the request before theorising about the block | A WAF-shaped response is not proof of an unsolvable challenge. A week was lost to impersonation/cookie/version theories when the difference was one header. |
| Activities are spots with a `kind`, not a new table | Same lifecycle and same fields as food spots; only the scoring dimensions differ. |
| Venue notification via Telegram bot, not a dashboard | Matches how Addis businesses actually operate; ~10× less product for the same job. |
| No own-delivery, ever | It's a logistics company, not a feature. Deep-link to beU/Deliver Addis/ZMall if anything. |
| No per-restaurant calorie numbers | Input doesn't exist, output is meaningless per-restaurant, and it's a health claim. Bands or nothing. |
| Every new billed stage gets a nullable "attempted at" timestamp | Stamped even on failure, so a re-run never re-spends. This is how `comments`/`normalize`/`geocode` already stay cheap; new stages inherit it or they leak money. |
| Scheduled runs must pin `--limit` and `--min-views` | `--limit` bounds only the scrape stage; the metered stages downstream would otherwise process the whole backlog unattended. |

---

## Open questions

1. Which activity-review channels exist in Addis? This is unresearched and it
   gates §1a. Worth an hour of manual TikTok browsing before any code.
2. Does LinkUp Addis have terms that prohibit republication, and do we want to
   credit/link back per event? (Linking back is probably good for both sides.)
3. What did the user who asked for calories actually want to do with the number?
   Answering this decides §3 entirely.
4. Is there an existing weekly rhythm worth attaching notifications to later —
   "5 new spots this week" as a push? Deferred, but it's the natural payoff of P0.
5. **Check the project's PostgREST `db-max-rows` setting before the catalog
   nears 1000.** The web app fetches the whole catalog with an unpaginated
   `select *`, and PostgREST truncates past that cap **silently** — no error, the
   list is just short. Every item in this file is designed to grow the catalog
   (386 today, plus ~30 activity seeds, plus weekly scrapes), so this becomes a
   live risk on the success path, and its failure mode is invisible. Verify the
   setting, then decide between raising it and paginating.
