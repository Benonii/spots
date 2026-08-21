/**
 * LLM extraction contract (Zod) for a Telegram post → a happening.
 *
 * One `generateObject` call per post. Separate from extraction.ts because the
 * two share nothing: that one judges a permanent venue on five quality
 * dimensions, this one pulls a date and a price out of an announcement and
 * decides whether the post is an event at all.
 *
 * Every field is `.nullable()` rather than `.optional()`, and none carry
 * `.default()`: OpenAI's strict structured output requires every property to
 * appear in `required`, and either of those makes a field optional.
 */
import { z } from "zod";

/**
 * Event categories, chosen from what the channel actually posts: 492 posts over
 * 93 days break down roughly music 30%, film 18%, art 15%, food 13%,
 * outdoors 9%, market 9%, talk 6%. `sport` was in an earlier draft and is gone —
 * two posts in three months is a filter nobody can use.
 *
 * Kept few on purpose. With 30-50 events in a typical upcoming window, a
 * category matching two of them is clutter rather than a filter.
 *
 * The model assigns these rather than a regex: 19% of dated posts contain no
 * category word at all ("Afropia Dance Battle", "Ethiopian CyberShield 2026"),
 * so keyword matching silently drops a fifth of the catalog.
 */
export const HAPPENING_TAGS = [
  "music",
  "art",
  "film",
  "food",
  "market",
  "outdoors",
  "talk",
] as const;

export type HappeningTag = (typeof HAPPENING_TAGS)[number];

export const happeningExtractionSchema = z.object({
  /**
   * The gate, deliberately separate from `confidence`. The channel posts plenty
   * that isn't an event — job ads, magazine features, course announcements — and
   * the model can be entirely confident that a post is not one. Folding the two
   * together would read "certainly not an event" as "uncertain".
   */
  isEvent: z.boolean(),

  title: z.string().nullable(),
  summary: z.string().nullable(),
  venueName: z.string().nullable(),

  /**
   * ISO 8601 with an explicit offset. Validated and range-checked by the caller
   * rather than by Zod, so a malformed date degrades to "needs review" instead
   * of throwing away the rest of a good extraction.
   */
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),

  priceMin: z.number().nullable(),
  priceMax: z.number().nullable(),
  ticketUrl: z.string().nullable(),

  /**
   * A closed vocabulary, enforced here rather than only asked for in the
   * prompt. The app builds its filter chips from this list, so a novel tag
   * would be a category nobody can ever select — and prompts drift.
   */
  tags: z.array(z.enum(HAPPENING_TAGS)),

  /** 0..1. How sure the model is of the event details, not of `isEvent`. */
  confidence: z.number().min(0).max(1),
});

export type HappeningExtraction = z.infer<typeof happeningExtractionSchema>;

/**
 * Addis Ababa is UTC+3 year-round with no DST, so a post saying "7 PM" means
 * 19:00+03:00 and nothing else. The model is told to stamp this offset; this
 * constant exists so the prompt and any future formatting agree on one source.
 */
export const ADDIS_OFFSET = "+03:00";

export const EXTRACTION_SYSTEM = `You read a post from an Addis Ababa events Telegram channel and extract the event it announces, if it announces one.

isEvent — the most important field. true only for a specific, time-bound happening someone could attend: a concert, party, festival, pop-up, screening, exhibition, market, talk, sports fixture. false for everything else the channel posts: magazine articles, job openings, course and scholarship announcements, product launches, news, venue profiles with no date, and general promotion. When isEvent is false, set every other field to null and confidence to how sure you are that it is not an event.

startsAt / endsAt — ISO 8601 with the offset ${ADDIS_OFFSET} (Addis Ababa, no daylight saving).
- Resolve every relative date against the POSTED date given below, never against any other date. "this Saturday" means the Saturday following the posted date.
- A date with no time: use 00:00${ADDIS_OFFSET} and lower confidence.
- A time with no date is NOT a date. Leave startsAt null.
- Ethiopian calendar dates (e.g. ነሐሴ ፲፭) — convert to Gregorian only if you are certain; otherwise null.
- endsAt only when an end is actually stated, or for a multi-day event. Never guess a duration.
- Never invent a year. If the post names a month and day without a year, assume the first such date on or after the posted date.

venueName — the place it happens, as written ("Anki Liquor", "Golden Tulip Hotel"). null if unnamed.

title — short name of the event as the channel calls it ("Static III", "Ctrl Ep. 2"). Not a sentence.

summary — one neutral sentence describing what it is. No marketing language.

priceMin / priceMax — ticket price in Ethiopian Birr as plain numbers. priceMax only for a stated range. Free events are 0. Unstated is null.

tags — one to three from exactly this list, most important first: ${HAPPENING_TAGS.join(", ")}. Use nothing outside it.
- music: DJs, concerts, club nights, live bands, dancing.
- art: exhibitions, galleries, poetry, theatre, performance.
- film: screenings, cinema, documentaries.
- food: tastings, brunches, food festivals, coffee events.
- market: pop-ups, bazaars, craft fairs, vendor markets.
- outdoors: hikes, runs, cycling, tours, anything held outside the city.
- talk: conferences, panels, workshops, training, meetups.
A cultural or religious celebration takes the tag of what actually happens at it — a holiday concert is music. Empty list only when the post is not an event.

ticketUrl — a real http(s) URL for tickets only. A Telegram handle like @Afromile is NOT a URL; leave null.

confidence — 0 to 1, covering the event details as a whole, most importantly the date. Be strict: 0.9+ means the post states an explicit date you copied directly. Below 0.5 means you inferred or guessed the date. A wrong date is far more costly than a missing one.

Extract only what the post says. Never invent a venue, a price, or a date.`;

/**
 * Sanity window for an extracted date. A model that invents a year usually
 * invents one far away, and a date outside this range is a stronger signal of a
 * bad extraction than any confidence score — so it drops to review rather than
 * being trusted. Wide enough for a festival announced a year out.
 */
const MAX_YEARS_AHEAD = 2;
// Also the effective depth limit on a history backfill: a post older than this
// has its date nulled and lands in review for ever. Raise both together if the
// poll is ever walked back further than a year.
const MAX_DAYS_BEHIND = 365;

export function parseEventDate(value: string | null, now: Date): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const yearsAhead = (parsed.getTime() - now.getTime()) / (365 * 864e5);
  const daysBehind = (now.getTime() - parsed.getTime()) / 864e5;
  if (yearsAhead > MAX_YEARS_AHEAD || daysBehind > MAX_DAYS_BEHIND) return null;
  return parsed;
}

export type Routed = {
  status: "pending" | "published" | "rejected";
  rejectedReason: string | null;
};

const ADDIS_OFFSET_MS = 3 * 3600e3;

/**
 * When an event stops being worth showing.
 *
 * Not `startsAt`. Most posts state a start and no end, and an exhibition that
 * opens at 09:00 is still on at 09:01 — treating the start as the expiry killed
 * a genuine same-day event on the first real run. Absent a stated end, an event
 * runs until the end of its own day in Addis, which is also how a reader thinks
 * about it ("is it on today?").
 */
export function expiresAt(startsAt: Date, endsAt: Date | null): Date {
  if (endsAt) return endsAt;
  // Shift into Addis wall-clock, snap to the end of that day, shift back.
  const local = new Date(startsAt.getTime() + ADDIS_OFFSET_MS);
  local.setUTCHours(23, 59, 59, 999);
  return new Date(local.getTime() - ADDIS_OFFSET_MS);
}

/**
 * Decide where an extracted post lands. Order matters: the cheap disqualifiers
 * run before the date checks so a job ad is never scrutinised for a start time.
 *
 * Nothing here can publish an undated row — the DB check constraint enforces
 * that independently, but the ordering means we never even try.
 */
export function route(
  extraction: HappeningExtraction,
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date,
  publishAbove: number | null,
): Routed {
  if (!extraction.isEvent) {
    return { status: "rejected", rejectedReason: "not an event" };
  }
  if (!startsAt) {
    // Either no date was stated or the one extracted failed the sanity window.
    // A human can still read the raw post and fill it in.
    return { status: "pending", rejectedReason: null };
  }
  if (expiresAt(startsAt, endsAt).getTime() < now.getTime()) {
    return { status: "rejected", rejectedReason: "already happened" };
  }
  if (publishAbove !== null && extraction.confidence >= publishAbove) {
    return { status: "published", rejectedReason: null };
  }
  return { status: "pending", rejectedReason: null };
}

/**
 * YYYY-MM-DD as Addis reads it. Rendering a stored instant with toISOString()
 * shows the UTC day, so an event at midnight local prints as the day before —
 * which makes a correctly-routed row look like a bug in the log.
 */
export function addisDate(date: Date): string {
  return new Date(date.getTime() + ADDIS_OFFSET_MS).toISOString().slice(0, 10);
}

export function buildPrompt(postedAt: Date | null, rawText: string): string {
  const posted = postedAt
    ? postedAt.toISOString()
    : "(unknown — treat every relative date as unresolvable)";
  return `POSTED: ${posted}\nTIMEZONE: ${ADDIS_OFFSET} (Africa/Addis_Ababa)\n\nPOST:\n${rawText}`;
}

