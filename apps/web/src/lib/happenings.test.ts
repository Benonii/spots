import { expect, test, describe } from "bun:test";
import type { Happening } from "./types";
import {
  addisDayKey,
  dayLabel,
  dedupe,
  groupByDay,
  priceLabel,
  startOfAddisToday,
  timeLabel,
} from "./happenings";

const NOW = new Date("2026-08-21T09:00:00Z"); // 12:00 in Addis

const make = (over: Partial<Happening> = {}): Happening => ({
  id: "a",
  source_url: "https://t.me/linkupaddis/1",
  image_url: null,
  title: "Static III",
  summary: null,
  venue_name: "Anki Liquor",
  starts_at: "2026-08-29T19:00:00+03:00",
  ends_at: null,
  price_min: 700,
  price_max: null,
  price_currency: "ETB",
  ticket_url: null,
  confidence: 0.9,
  ...over,
});

describe("addisDayKey", () => {
  // The case that makes viewer-timezone grouping wrong: a 9pm Addis event is
  // already the next day in UTC, and would file under the wrong heading.
  test("groups by the Addis day, not the UTC day", () => {
    expect(addisDayKey("2026-08-21T22:00:00+03:00")).toBe("2026-08-21");
    expect(addisDayKey("2026-08-22T00:30:00+03:00")).toBe("2026-08-22");
  });
});

describe("startOfAddisToday", () => {
  test("is midnight in Addis, expressed as an instant", () => {
    expect(startOfAddisToday(NOW)).toBe("2026-08-20T21:00:00.000Z");
  });
});

describe("dayLabel", () => {
  test("names today and tomorrow rather than dating them", () => {
    expect(dayLabel("2026-08-21T19:00:00+03:00", NOW)).toBe("Today");
    expect(dayLabel("2026-08-22T19:00:00+03:00", NOW)).toBe("Tomorrow");
  });

  test("dates anything further out", () => {
    expect(dayLabel("2026-08-29T19:00:00+03:00", NOW)).toBe("Saturday 29 Aug");
  });

  // Tomorrow is in a different month, which naive +1-to-the-date arithmetic
  // gets wrong.
  test("crosses a month boundary", () => {
    const lastDay = new Date("2026-08-31T09:00:00Z");
    expect(dayLabel("2026-09-01T19:00:00+03:00", lastDay)).toBe("Tomorrow");
  });
});

describe("timeLabel", () => {
  test("renders a stated time in 12-hour form", () => {
    expect(timeLabel("2026-08-29T19:00:00+03:00")).toBe("7:00 PM");
    expect(timeLabel("2026-08-29T09:30:00+03:00")).toBe("9:30 AM");
    expect(timeLabel("2026-08-29T12:00:00+03:00")).toBe("12:00 PM");
  });

  // Extraction writes midnight when the post gave a date but no time. Showing
  // "12:00 AM" would invent a detail the source never stated.
  test("midnight means the time is unknown, not midnight", () => {
    expect(timeLabel("2026-08-29T00:00:00+03:00")).toBeNull();
  });
});

describe("priceLabel", () => {
  test("zero is Free, not 0", () => {
    expect(priceLabel(make({ price_min: 0 }))).toBe("Free");
  });

  test("a single price and a range", () => {
    expect(priceLabel(make({ price_min: 700 }))).toBe("700 ETB");
    expect(priceLabel(make({ price_min: 300, price_max: 700 }))).toBe("300–700 ETB");
  });

  test("thousands are grouped", () => {
    expect(priceLabel(make({ price_min: 3000 }))).toBe("3,000 ETB");
  });

  test("no stated price renders nothing at all", () => {
    expect(priceLabel(make({ price_min: null }))).toBeNull();
  });

  // A range whose ends are equal is one price, not "700–700".
  test("a degenerate range collapses", () => {
    expect(priceLabel(make({ price_min: 700, price_max: 700 }))).toBe("700 ETB");
  });
});

describe("dedupe", () => {
  // Taken from the real feed: the channel promoted one night three times, and
  // the venue string drifted between posts.
  test("collapses repeat announcements of the same night", () => {
    const posts = [
      make({ id: "1", title: "Ctrl Ep. 2", venue_name: "Golden Tulip Hotel", starts_at: "2026-08-22T00:00:00+03:00", confidence: 0.9 }),
      make({ id: "2", title: "CTRL EP02", venue_name: "Golden Tulip", starts_at: "2026-08-22T00:00:00+03:00", confidence: 0.88 }),
      make({ id: "3", title: "Ctrl Ep. 2", venue_name: "Golden Tulip Hotel", starts_at: "2026-08-22T00:00:00+03:00", confidence: 0.85 }),
    ];
    const kept = dedupe(posts);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).toBe("1"); // the most confident extraction wins
  });

  test("keeps two different venues on the same night", () => {
    const kept = dedupe([
      make({ id: "1", venue_name: "Anki Liquor", starts_at: "2026-08-22T19:00:00+03:00" }),
      make({ id: "2", venue_name: "Golden Tulip", starts_at: "2026-08-22T19:00:00+03:00" }),
    ]);
    expect(kept).toHaveLength(2);
  });

  // The conservative half of the rule: a venue that runs a weekly night must
  // keep every week, so the day is always part of the key.
  test("keeps the same venue on different nights", () => {
    const kept = dedupe([
      make({ id: "1", venue_name: "Anki Liquor", starts_at: "2026-08-22T19:00:00+03:00" }),
      make({ id: "2", venue_name: "Anki Liquor", starts_at: "2026-08-29T19:00:00+03:00" }),
    ]);
    expect(kept).toHaveLength(2);
  });

  test("returns events in chronological order", () => {
    const kept = dedupe([
      make({ id: "late", venue_name: "B", starts_at: "2026-08-29T19:00:00+03:00" }),
      make({ id: "early", venue_name: "A", starts_at: "2026-08-22T19:00:00+03:00" }),
    ]);
    expect(kept.map((h) => h.id)).toEqual(["early", "late"]);
  });

  test("an unnamed venue falls back to the title", () => {
    const kept = dedupe([
      make({ id: "1", venue_name: null, title: "Beans and Books" }),
      make({ id: "2", venue_name: null, title: "Beans & Books" }),
    ]);
    expect(kept).toHaveLength(1);
  });
});

describe("groupByDay", () => {
  test("splits a sorted list into labelled days", () => {
    const groups = groupByDay(
      [
        make({ id: "1", starts_at: "2026-08-21T19:00:00+03:00" }),
        make({ id: "2", starts_at: "2026-08-21T22:00:00+03:00" }),
        make({ id: "3", starts_at: "2026-08-22T19:00:00+03:00" }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Tomorrow"]);
    expect(groups[0]!.happenings).toHaveLength(2);
    expect(groups[1]!.happenings).toHaveLength(1);
  });

  test("no events, no groups", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});
