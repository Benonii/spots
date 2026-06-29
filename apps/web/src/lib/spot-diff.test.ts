import { expect, test, describe } from "bun:test";
import { diffSpot, type SpotDraft } from "./spot-diff";
import type { Spot } from "./types";

const base: Spot = {
  id: "s1",
  google_place_id: "manual:abc",
  name: "Tomoca",
  neighborhood: "Piassa",
  address: "Wawel St",
  lat: 9.03,
  lng: 38.74,
  price_min: 200,
  price_max: 400,
  price_currency: "ETB",
  price_basis: "per_person",
  price_level: 1,
  quality_score: 70,
  quality_signals: {
    dimensions: { aesthetic: 4, vibe: 4, food: 4, value: 4, service: 4 },
    evidence: { positiveMentions: 0, negativeMentions: 0, aestheticMentions: 0 },
  },
  tags: ["coffee", "cozy"],
  summary: "Great coffee",
  video_count: 0,
  cover_image_url: "https://x/cover.jpg",
  source_video_url: null,
  first_seen_at: "2026-01-01",
  source: "manual",
  owner_id: "u1",
  hidden: false,
  map_url: "https://maps.google.com/?q=9.03,38.74",
  locked_fields: [],
};

/** A draft that exactly mirrors a spot — i.e. "no edits". */
const draftOf = (s: Spot): SpotDraft => ({
  name: s.name,
  description: s.summary ?? "",
  mapUrl: s.map_url ?? "",
  tiktokUrl: s.source_video_url ?? "",
  lat: s.lat,
  lng: s.lng,
  neighborhood: s.neighborhood ?? "",
  address: s.address ?? "",
  tags: [...s.tags],
  priceMin: s.price_min,
  priceMax: s.price_max,
  priceBasis: s.price_basis,
  dimensions: { ...s.quality_signals.dimensions },
});

describe("diffSpot", () => {
  test("an unchanged draft produces no patch and no locks", () => {
    const { patch, changed } = diffSpot(base, draftOf(base));
    expect(Object.keys(patch)).toHaveLength(0);
    expect(changed.size).toBe(0);
  });

  test("renaming patches name and locks 'name'", () => {
    const { patch, changed } = diffSpot(base, { ...draftOf(base), name: "Tomoca Coffee" });
    expect(patch.name).toBe("Tomoca Coffee");
    expect([...changed]).toEqual(["name"]);
  });

  test("a blank name is ignored (can't wipe the name)", () => {
    const { patch, changed } = diffSpot(base, { ...draftOf(base), name: "   " });
    expect(patch.name).toBeUndefined();
    expect(changed.has("name")).toBe(false);
  });

  test("moving lat/lng or area both lock 'location'", () => {
    const moved = diffSpot(base, { ...draftOf(base), lat: 9.04 });
    expect(moved.patch.lat).toBe(9.04);
    expect(moved.changed.has("location")).toBe(true);

    const rehood = diffSpot(base, { ...draftOf(base), neighborhood: "Bole" });
    expect(rehood.patch.neighborhood).toBe("Bole");
    expect(rehood.changed.has("location")).toBe(true);
  });

  test("a TikTok link writes source_video_url and locks 'video'", () => {
    const { patch, changed } = diffSpot(base, {
      ...draftOf(base),
      tiktokUrl: "https://www.tiktok.com/@x/video/1",
    });
    expect(patch.source_video_url).toBe("https://www.tiktok.com/@x/video/1");
    expect(changed.has("video")).toBe(true);
  });

  test("changing the Maps link patches map_url but does NOT lock it", () => {
    const { patch, changed } = diffSpot(base, { ...draftOf(base), mapUrl: "https://maps.app.goo.gl/q" });
    expect(patch.map_url).toBe("https://maps.app.goo.gl/q");
    expect(changed.size).toBe(0); // map_url isn't scrape-owned, so it isn't locked
  });

  test("editing tags locks 'tags'", () => {
    const { patch, changed } = diffSpot(base, { ...draftOf(base), tags: ["coffee", "matcha"] });
    expect(patch.tags).toEqual(["coffee", "matcha"]);
    expect(changed.has("tags")).toBe(true);
  });

  test("a price change recomputes price_level and locks 'price'", () => {
    const { patch, changed } = diffSpot(base, { ...draftOf(base), priceMin: 1000, priceMax: 2000 });
    expect(patch.price_level).toBe(4); // midpoint 1500 → top band
    expect(changed.has("price")).toBe(true);
  });
});
