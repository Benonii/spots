import { expect, test, describe } from "bun:test";
import { parseMapsUrl, isShortMapsLink } from "./mapurl";

describe("parseMapsUrl", () => {
  test("prefers the exact place pin (!3d!4d) over the @ viewport center", () => {
    const url =
      "https://www.google.com/maps/place/Tomoca/@9.0123,38.7456,17z/data=!4m6!3m5!8m2!3d9.0150!4d38.7600";
    expect(parseMapsUrl(url)).toEqual({ lat: 9.015, lng: 38.76 });
  });

  test("falls back to /@lat,lng when there's no place pin", () => {
    expect(parseMapsUrl("https://www.google.com/maps/@9.0300,38.7600,15z")).toEqual({
      lat: 9.03,
      lng: 38.76,
    });
  });

  test("reads a q=lat,lng query coordinate", () => {
    expect(parseMapsUrl("https://maps.google.com/?q=8.9800,38.7900")).toEqual({
      lat: 8.98,
      lng: 38.79,
    });
  });

  test("returns null for out-of-range coordinates", () => {
    expect(parseMapsUrl("https://www.google.com/maps/@999.0,38.0,1z")).toBeNull();
  });

  test("returns null for junk / empty", () => {
    expect(parseMapsUrl("hello world")).toBeNull();
    expect(parseMapsUrl("")).toBeNull();
  });
});

describe("isShortMapsLink", () => {
  test("flags maps.app.goo.gl and goo.gl/maps", () => {
    expect(isShortMapsLink("https://maps.app.goo.gl/abc123")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/maps/abc")).toBe(true);
  });
  test("a full URL is not a short link", () => {
    expect(isShortMapsLink("https://www.google.com/maps/@9.03,38.76,15z")).toBe(false);
  });
});
