import { expect, test, describe } from "bun:test";
import {
  parseEventDate,
  route,
  buildPrompt,
  expiresAt,
  addisDate,
} from "./happenings-extraction.ts";
import type { HappeningExtraction } from "./happenings-extraction.ts";

const NOW = new Date("2026-08-21T09:00:00Z");

const event = (over: Partial<HappeningExtraction> = {}): HappeningExtraction => ({
  isEvent: true,
  title: "Static III",
  summary: "An afro house night.",
  venueName: "Anki Liquor",
  startsAt: "2026-08-29T19:00:00+03:00",
  endsAt: null,
  priceMin: 700,
  priceMax: null,
  ticketUrl: "https://afromile.com/x",
  tags: ["music"],
  confidence: 0.95,
  ...over,
});

describe("parseEventDate", () => {
  test("reads an ISO date with the Addis offset", () => {
    const parsed = parseEventDate("2026-08-29T19:00:00+03:00", NOW);
    expect(parsed?.toISOString()).toBe("2026-08-29T16:00:00.000Z");
  });

  test("null and unparseable input both give null", () => {
    expect(parseEventDate(null, NOW)).toBeNull();
    expect(parseEventDate("next Saturday", NOW)).toBeNull();
    expect(parseEventDate("", NOW)).toBeNull();
  });

  // A model that invents a year tends to invent a distant one. Rejecting the
  // date sends the row to review, which is recoverable; trusting it would put a
  // phantom event in the app for years.
  test("rejects dates outside the sanity window", () => {
    expect(parseEventDate("2031-08-29T19:00:00+03:00", NOW)).toBeNull();
    expect(parseEventDate("2019-08-29T19:00:00+03:00", NOW)).toBeNull();
  });

  test("keeps a recent past date so routing can reject it as expired", () => {
    // Distinct from the case above: this one is real and simply over, and the
    // reason it lands on ("already happened") should say so.
    expect(parseEventDate("2026-08-20T19:00:00+03:00", NOW)).not.toBeNull();
  });
});

describe("expiresAt", () => {
  // Found on the first real extraction run: an exhibition opening at 09:00 was
  // rejected as "already happened" at 09:01, because the start was being used
  // as the expiry. Most posts state a start and no end, so this is the norm,
  // not an edge case.
  test("an event with no stated end runs to the end of its day in Addis", () => {
    const opens = new Date("2026-08-21T09:00:00+03:00");
    expect(expiresAt(opens, null).toISOString()).toBe("2026-08-21T20:59:59.999Z");
  });

  test("a stated end wins over the end of the day", () => {
    const starts = new Date("2026-08-21T09:00:00+03:00");
    const ends = new Date("2026-08-21T18:00:00+03:00");
    expect(expiresAt(starts, ends)).toEqual(ends);
  });

  // A night that runs past midnight belongs to the day it started on.
  test("a late-night start still expires at that day's end", () => {
    const starts = new Date("2026-08-21T23:00:00+03:00");
    expect(expiresAt(starts, null).toISOString()).toBe("2026-08-21T20:59:59.999Z");
  });
});

describe("route", () => {
  const future = new Date("2026-08-29T16:00:00Z");
  const past = new Date("2026-08-19T16:00:00Z");

  test("an event earlier today is still live, not expired", () => {
    // NOW is 09:00Z = 12:00 in Addis; this one opened at 09:00 Addis.
    const openedThisMorning = new Date("2026-08-21T09:00:00+03:00");
    expect(route(event(), openedThisMorning, null, NOW, null).status).toBe(
      "pending",
    );
  });

  test("a non-event is rejected whatever else it carries", () => {
    const verdict = route(event({ isEvent: false }), future, null, NOW, 0.8);
    expect(verdict).toEqual({ status: "rejected", rejectedReason: "not an event" });
  });

  test("an expired event is rejected rather than queued for review", () => {
    const verdict = route(event(), past, null, NOW, 0.8);
    expect(verdict).toEqual({
      status: "rejected",
      rejectedReason: "already happened",
    });
  });

  // The property the whole feature rests on: no date, no publish. The DB check
  // constraint enforces this too, so this test guards the layer that should
  // never reach it.
  test("an undated event always goes to review, never live", () => {
    expect(route(event({ confidence: 1 }), null, null, NOW, 0.5).status).toBe("pending");
  });

  test("auto-publishes only at or above the threshold", () => {
    expect(route(event({ confidence: 0.95 }), future, null, NOW, 0.8).status).toBe(
      "published",
    );
    expect(route(event({ confidence: 0.8 }), future, null, NOW, 0.8).status).toBe(
      "published",
    );
    expect(route(event({ confidence: 0.79 }), future, null, NOW, 0.8).status).toBe(
      "pending",
    );
  });

  // Default behaviour until a threshold has been calibrated against real output.
  test("with no threshold set, nothing publishes itself", () => {
    expect(route(event({ confidence: 1 }), future, null, NOW, null).status).toBe(
      "pending",
    );
  });
});

describe("buildPrompt", () => {
  // Extraction can run days after the poll, so "this Saturday" has to resolve
  // against when the post was written, not when the model reads it.
  test("carries the post's own date, not the current one", () => {
    const prompt = buildPrompt(new Date("2026-08-17T06:57:26Z"), "Static returns");
    expect(prompt).toContain("POSTED: 2026-08-17T06:57:26.000Z");
    expect(prompt).toContain("Static returns");
  });

  test("says so explicitly when the post has no date", () => {
    expect(buildPrompt(null, "x")).toContain("unknown");
  });
});

describe("addisDate", () => {
  // A midnight-local event is 21:00 UTC the previous day. Printing the UTC day
  // made correctly-routed rows look mis-dated in the extraction log.
  test("renders the Addis day, not the UTC one", () => {
    expect(addisDate(new Date("2026-08-21T00:00:00+03:00"))).toBe("2026-08-21");
    expect(addisDate(new Date("2026-08-21T23:30:00+03:00"))).toBe("2026-08-21");
  });
});
