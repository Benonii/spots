import { expect, test, describe } from "bun:test";
import { aggregateSpot, type VideoForAgg } from "./aggregate.ts";
import type { Extraction, GeoResult } from "@date-finder/db";

const geo: GeoResult = {
  placeId: "p1",
  lat: 9,
  lng: 38,
  formattedAddress: "Addis",
  priceLevel: null,
};

function video(e: Partial<Extraction>, engagement = 0): VideoForAgg {
  return {
    engagement,
    geo,
    extraction: {
      venueName: "Cafe",
      neighborhood: null,
      price: { min: null, max: null, currency: "ETB", basis: "unknown" },
      tags: [],
      summary: "",
      dimensions: { aesthetic: 0, vibe: 0, food: 0, value: 0, service: 0 },
      evidence: { positiveMentions: 0, negativeMentions: 0, aestheticMentions: 0 },
      ...e,
    },
  };
}

describe("aggregateSpot", () => {
  test("single video passes dimensions through", () => {
    const r = aggregateSpot([
      video({
        dimensions: { aesthetic: 4, vibe: 4, food: 4, value: 4, service: 4 },
      }),
    ]);
    expect(r.videoCount).toBe(1);
    expect(r.qualitySignals.dimensions.aesthetic).toBe(4);
  });

  test("means dimensions, sums evidence across videos", () => {
    const r = aggregateSpot([
      video({
        dimensions: { aesthetic: 4, vibe: 4, food: 4, value: 4, service: 4 },
        evidence: { positiveMentions: 10, negativeMentions: 1, aestheticMentions: 5 },
      }),
      video({
        dimensions: { aesthetic: 2, vibe: 2, food: 2, value: 2, service: 2 },
        evidence: { positiveMentions: 6, negativeMentions: 3, aestheticMentions: 1 },
      }),
    ]);
    expect(r.videoCount).toBe(2);
    expect(r.qualitySignals.dimensions.aesthetic).toBe(3); // mean(4,2)
    expect(r.qualitySignals.evidence.positiveMentions).toBe(16); // sum
    expect(r.qualitySignals.evidence.negativeMentions).toBe(4);
  });

  test("price: lowest min, highest max, prefers per_person basis", () => {
    const r = aggregateSpot([
      video({ price: { min: 800, max: null, currency: "ETB", basis: "total" } }),
      video({ price: { min: 400, max: 600, currency: "ETB", basis: "per_person" } }),
    ]);
    expect(r.priceMin).toBe(400);
    expect(r.priceMax).toBe(600);
    expect(r.priceBasis).toBe("per_person");
  });

  test("tags union; summary + neighborhood from highest engagement", () => {
    const r = aggregateSpot([
      video({ tags: ["rooftop", "coffee"], summary: "low", neighborhood: "Bole" }, 5),
      video({ tags: ["coffee", "quiet"], summary: "HIGH", neighborhood: "Kazanchis" }, 50),
    ]);
    expect(new Set(r.tags)).toEqual(new Set(["rooftop", "coffee", "quiet"]));
    expect(r.summary).toBe("HIGH");
    expect(r.neighborhood).toBe("Kazanchis");
  });

  test("throws on empty input", () => {
    expect(() => aggregateSpot([])).toThrow();
  });
});
