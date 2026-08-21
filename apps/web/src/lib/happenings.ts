import type { Happening } from "./types";

/**
 * Presentation logic for the events list. Pure — everything here takes an ISO
 * string or a Happening and returns something renderable, so the awkward parts
 * (timezone, date-only events, duplicate posts) are testable without a DOM.
 *
 * Addis Ababa is UTC+3 year-round with no DST. Every date decision here is made
 * in Addis wall-clock rather than the viewer's timezone: an event is "on
 * Saturday" in the city it happens in, not in the city you happen to be reading
 * from. This also keeps the view's notion of "today" identical to the CLI's
 * expiry rule (see apps/cli/src/happenings-extraction.ts).
 */
const ADDIS_OFFSET_MS = 3 * 3600e3;

/** The instant shifted into Addis wall-clock, for reading date parts off UTC getters. */
function addisClock(iso: string): Date {
  return new Date(new Date(iso).getTime() + ADDIS_OFFSET_MS);
}

/** YYYY-MM-DD in Addis — the grouping key for a day. */
export function addisDayKey(iso: string): string {
  return addisClock(iso).toISOString().slice(0, 10);
}

/** Midnight in Addis, today, as an ISO instant. The "still on" cutoff. */
export function startOfAddisToday(now = new Date()): string {
  const local = new Date(now.getTime() + ADDIS_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - ADDIS_OFFSET_MS).toISOString();
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Today" / "Tomorrow" / "Saturday 22 Aug" — the heading for a day group.
 * The two relative labels do most of the work: the common question is "what's
 * on tonight", and a date alone makes the reader do the arithmetic.
 */
export function dayLabel(iso: string, now = new Date()): string {
  const key = addisDayKey(iso);
  const today = addisDayKey(now.toISOString());
  if (key === today) return "Today";
  const tomorrow = addisDayKey(
    new Date(new Date(today + "T12:00:00Z").getTime() + 864e5).toISOString(),
  );
  if (key === tomorrow) return "Tomorrow";
  const d = addisClock(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * "9:00 PM", or null when the post never stated a time.
 *
 * Extraction writes midnight for a date-only post (see the prompt's "a date
 * with no time" rule), so exactly 00:00 in Addis means "day known, time not".
 * Rendering that as "12:00 AM" would invent a detail the source never gave —
 * about ten of the first two dozen events are date-only.
 */
export function timeLabel(iso: string): string | null {
  const d = addisClock(iso);
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  if (hours === 0 && minutes === 0) return null;
  const suffix = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/**
 * What to head the row with, and whether the venue has already been used up.
 *
 * Some posts describe an event without ever naming it. "Untitled event" is a
 * database word, not something to show a reader — the venue is the next most
 * useful handle, and repeating it underneath would just be the same line twice.
 */
export function heading(happening: Happening): { title: string; venueUsed: boolean } {
  if (happening.title) return { title: happening.title, venueUsed: false };
  if (happening.venue_name) return { title: happening.venue_name, venueUsed: true };
  return { title: "An evening out", venueUsed: false };
}

/** "Free" / "700 ETB" / "300–700 ETB", or null when no price was stated. */
export function priceLabel(happening: Happening): string | null {
  const { price_min: min, price_max: max, price_currency: currency } = happening;
  if (min == null) return null;
  if (min === 0 && (max == null || max === 0)) return "Free";
  const money = (n: number) => n.toLocaleString("en-US");
  return max != null && max !== min
    ? `${money(min)}–${money(max)} ${currency}`
    : `${money(min)} ${currency}`;
}

/**
 * Loose key for "these two posts are about the same event".
 *
 * The channel promotes an event several times before it happens, so the raw
 * feed carries the same night three or four times under drifting names — "Ctrl
 * Ep. 2", "CTRL EP02", at "Golden Tulip Hotel" and "Golden Tulip". Matching on
 * the venue's first two significant words plus the day catches those without
 * needing the titles to agree.
 */
// Dropped before the key is built, so "The Velvet Rooftop" and "Velvet
// Rooftop" agree, and "Beans and Books" survives being written "Beans & Books"
// (the ampersand is punctuation, the word is not).
const NOISE_WORDS = new Set(["the", "a", "an", "and", "at", "in", "of", "on"]);

function dedupeKey(happening: Happening): string {
  const day = addisDayKey(happening.starts_at);
  const source = happening.venue_name ?? happening.title ?? happening.id;
  const words = source
    .toLowerCase()
    .replace(/[^a-z0-9ሀ-፿\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !NOISE_WORDS.has(word))
    .slice(0, 2)
    .join(" ");
  return `${day}|${words || happening.id}`;
}

/**
 * Collapse repeat announcements, keeping the most confident version of each.
 *
 * Interim: the right place to solve this is at review time, where a person can
 * see that three posts describe one night. Until then the raw list reads as
 * broken — a third of the current feed is duplicates — so the view has to do
 * something. Deliberately conservative: same venue AND same day, never across
 * days, so a venue with two genuinely different nights is unaffected.
 */
export function dedupe(happenings: Happening[]): Happening[] {
  const best = new Map<string, Happening>();
  for (const happening of happenings) {
    const key = dedupeKey(happening);
    const held = best.get(key);
    if (!held || (happening.confidence ?? 0) > (held.confidence ?? 0)) {
      best.set(key, happening);
    }
  }
  return [...best.values()].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
}

export type DayGroup = { key: string; label: string; happenings: Happening[] };

/** Chronological day groups, ready to render. Assumes input is already deduped. */
export function groupByDay(happenings: Happening[], now = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const happening of happenings) {
    const key = addisDayKey(happening.starts_at);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.happenings.push(happening);
    else groups.push({ key, label: dayLabel(happening.starts_at, now), happenings: [happening] });
  }
  return groups;
}

/**
 * Deterministic warm gradient behind a flyer — the same idea as a spot's cover
 * fallback, keyed on the event so it doesn't reshuffle between renders. Used
 * while the image loads and if it never arrives (Telegram's CDN is a third
 * party we don't control).
 */
const FLYER_GRADIENTS = [
  "linear-gradient(160deg, #9FB68F 0%, #7E9579 100%)",
  "linear-gradient(160deg, #ECC079 0%, #E6A94F 100%)",
  "linear-gradient(160deg, #EA9560 0%, #E37B33 100%)",
  "linear-gradient(160deg, #A7BE9C 0%, #82996F 100%)",
  "linear-gradient(160deg, #E9B97E 0%, #D9924B 100%)",
  "linear-gradient(160deg, #B9AC90 0%, #968870 100%)",
];

export function flyerGradient(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return FLYER_GRADIENTS[Math.abs(hash) % FLYER_GRADIENTS.length]!;
}
