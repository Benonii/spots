import { expect, test, describe } from "bun:test";
import type { Happening } from "./types";
import {
  addisDayKey,
  calendarUrl,
  countdown,
} from "./happenings";
import {
  dateStamp,
  dayLabel,
  dedupe,
} from "./happenings";
import {
  flyerSrcSet,
  priceLabel,
  startOfAddisToday,
  timeLabel,
} from "./happenings";
import { isFree, matchesKinds, matchesWhen } from "./happenings";

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
  tags: ["music"],
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

describe("countdown", () => {
  test("counts whole Addis days, not elapsed hours", () => {
    // 9pm tonight is nine hours away but still "Today"; 9am tomorrow is closer
    // to twelve hours away and still "Tomorrow".
    expect(countdown("2026-08-21T21:00:00+03:00", NOW)).toBe("Today");
    expect(countdown("2026-08-22T09:00:00+03:00", NOW)).toBe("Tomorrow");
  });

  test("days, then weeks", () => {
    expect(countdown("2026-08-24T19:00:00+03:00", NOW)).toBe("in 3 days");
    expect(countdown("2026-08-29T19:00:00+03:00", NOW)).toBe("in a week");
    expect(countdown("2026-09-14T19:00:00+03:00", NOW)).toBe("in 3 weeks");
  });

  // An all-day event that opened this morning is still worth showing.
  test("something already started reads as on now", () => {
    expect(countdown("2026-08-20T19:00:00+03:00", NOW)).toBe("On now");
  });
});

describe("dateStamp", () => {
  test("splits the date for the card headline", () => {
    expect(dateStamp("2026-08-29T19:00:00+03:00")).toEqual({
      weekday: "Sat",
      day: "29",
      month: "Aug",
    });
  });

  // Midnight in Addis is the previous day in UTC — the stamp must not slip back.
  test("a midnight event stamps its own day", () => {
    expect(dateStamp("2026-08-22T00:00:00+03:00").day).toBe("22");
  });
});

describe("flyerSrcSet", () => {
  test("derives the stored WebP variants", () => {
    expect(flyerSrcSet("https://x.supabase.co/storage/v1/object/public/spot-covers/happenings/abc.jpg"))
      .toBe(
        "https://x.supabase.co/storage/v1/object/public/spot-covers/happenings/abc-480.webp 480w, " +
          "https://x.supabase.co/storage/v1/object/public/spot-covers/happenings/abc-960.webp 960w",
      );
  });

  // A flyer still on Telegram has no variants — and is about to expire anyway.
  test("no variants for a foreign url", () => {
    expect(flyerSrcSet("https://cdn4.telesco.pe/file/abc")).toBeUndefined();
    expect(flyerSrcSet(null)).toBeUndefined();
  });
});

describe("calendarUrl", () => {
  test("carries the title, venue and a real time window", () => {
    const url = new URL(calendarUrl(make()));
    expect(url.searchParams.get("text")).toBe("Static III");
    expect(url.searchParams.get("location")).toBe("Anki Liquor");
    expect(url.searchParams.get("dates")).toBe("20260829T160000Z/20260829T190000Z");
  });

  test("a stated end wins over the assumed three hours", () => {
    const url = new URL(calendarUrl(make({ ends_at: "2026-08-29T23:00:00+03:00" })));
    expect(url.searchParams.get("dates")).toBe("20260829T160000Z/20260829T200000Z");
  });
});

describe("matchesWhen", () => {
  // NOW is Friday 21 Aug 2026, 12:00 in Addis.
  const at = (iso: string, over: Partial<Happening> = {}) => make({ starts_at: iso, ...over });

  test("anything already over is out of every window", () => {
    const gone = at("2026-08-19T19:00:00+03:00");
    for (const when of ["upcoming", "today", "weekend", "month"] as const) {
      expect(matchesWhen(gone, when, NOW)).toBe(false);
    }
  });

  // The multi-day case the server predicate also has to handle: day two of a
  // festival is still on, even though it started before today.
  test("a running multi-day event stays in", () => {
    const festival = at("2026-08-20T10:00:00+03:00", { ends_at: "2026-08-23T22:00:00+03:00" });
    expect(matchesWhen(festival, "upcoming", NOW)).toBe(true);
    expect(matchesWhen(festival, "weekend", NOW)).toBe(true);
  });

  test("today means today in Addis", () => {
    expect(matchesWhen(at("2026-08-21T21:00:00+03:00"), "today", NOW)).toBe(true);
    expect(matchesWhen(at("2026-08-22T09:00:00+03:00"), "today", NOW)).toBe(false);
  });

  test("the weekend is Friday through Sunday", () => {
    expect(matchesWhen(at("2026-08-21T21:00:00+03:00"), "weekend", NOW)).toBe(true); // Fri
    expect(matchesWhen(at("2026-08-23T18:00:00+03:00"), "weekend", NOW)).toBe(true); // Sun
    expect(matchesWhen(at("2026-08-25T18:00:00+03:00"), "weekend", NOW)).toBe(false); // Tue
    expect(matchesWhen(at("2026-08-29T18:00:00+03:00"), "weekend", NOW)).toBe(false); // next Sat
  });

  // On a Sunday the weekend that matters is the one ending, not the one five
  // days out — otherwise the filter goes empty exactly when people are using it.
  test("on Sunday the weekend is the current one", () => {
    const sunday = new Date("2026-08-23T09:00:00Z");
    expect(matchesWhen(at("2026-08-23T18:00:00+03:00"), "weekend", sunday)).toBe(true);
  });

  test("within a month excludes the far future", () => {
    expect(matchesWhen(at("2026-09-14T18:00:00+03:00"), "month", NOW)).toBe(true);
    expect(matchesWhen(at("2026-11-01T18:00:00+03:00"), "month", NOW)).toBe(false);
  });
});

describe("matchesKinds", () => {
  test("no chips selected matches everything", () => {
    expect(matchesKinds(make({ tags: [] }), new Set())).toBe(true);
  });

  // "Art & film" is one chip over two tags, because that's one question.
  test("a grouped chip covers both its tags", () => {
    expect(matchesKinds(make({ tags: ["film"] }), new Set(["art"]))).toBe(true);
    expect(matchesKinds(make({ tags: ["art"] }), new Set(["art"]))).toBe(true);
  });

  test("chips widen rather than narrow", () => {
    const gig = make({ tags: ["music"] });
    expect(matchesKinds(gig, new Set(["food"]))).toBe(false);
    expect(matchesKinds(gig, new Set(["food", "music"]))).toBe(true);
  });
});

describe("isFree", () => {
  test("only an explicit zero is free", () => {
    expect(isFree(make({ price_min: 0 }))).toBe(true);
    expect(isFree(make({ price_min: 700 }))).toBe(false);
    // 72% of posts state no price — unknown must never read as free.
    expect(isFree(make({ price_min: null }))).toBe(false);
  });
});
