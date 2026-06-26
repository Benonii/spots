import { expect, test, describe } from "bun:test";
import { qualityScore, priceLevel } from "./scoring";
import type { QualitySignals } from "./schema";

const signals: QualitySignals = {
  dimensions: { aesthetic: 4.5, vibe: 4.0, food: 3.5, value: 4.0, service: 3.0 },
  evidence: { positiveMentions: 18, negativeMentions: 2, aestheticMentions: 9 },
};
// base = (4.5+4.0+3.5 + 4.0*1.2 + 3.0*0.8) / 5.0 = 19.2 / 5 = 3.84

describe("qualityScore", () => {
  test("1 video → evidenceFactor 0.90", () => {
    expect(qualityScore(signals, 1)).toBe(69); // 3.84*20*0.90 = 69.12
  });
  test("3+ videos → evidenceFactor 1.00", () => {
    expect(qualityScore(signals, 3)).toBe(77); // 3.84*20*1.00 = 76.8
    expect(qualityScore(signals, 9)).toBe(77); // capped at 3
  });
  test("0 videos (manual spot) → evidenceFactor 0.85", () => {
    expect(qualityScore(signals, 0)).toBe(65); // 3.84*20*0.85 = 65.28
  });
  test("all-zero dimensions → 0", () => {
    const z: QualitySignals = {
      dimensions: { aesthetic: 0, vibe: 0, food: 0, value: 0, service: 0 },
      evidence: { positiveMentions: 0, negativeMentions: 0, aestheticMentions: 0 },
    };
    expect(qualityScore(z, 5)).toBe(0);
  });
  test("clamps to 100", () => {
    const max: QualitySignals = {
      dimensions: { aesthetic: 5, vibe: 5, food: 5, value: 5, service: 5 },
      evidence: signals.evidence,
    };
    expect(qualityScore(max, 3)).toBe(100);
  });
});

describe("priceLevel", () => {
  test("per_person buckets", () => {
    expect(priceLevel(200, null, "per_person")).toBe(1);
    expect(priceLevel(500, null, "per_person")).toBe(2);
    expect(priceLevel(1000, null, "per_person")).toBe(3);
    expect(priceLevel(2000, null, "per_person")).toBe(4);
  });
  test("total basis halves to per-person", () => {
    expect(priceLevel(1000, null, "total")).toBe(2); // 500 pp
  });
  test("range uses midpoint", () => {
    expect(priceLevel(600, 800, "per_person")).toBe(3); // mid 700
  });
  test("no price → null", () => {
    expect(priceLevel(null, null, "unknown")).toBeNull();
  });
  test("bucket boundaries", () => {
    expect(priceLevel(300, null, "per_person")).toBe(2); // 300 is level 2
    expect(priceLevel(700, null, "per_person")).toBe(3); // 700 is level 3
    expect(priceLevel(1500, null, "per_person")).toBe(4); // 1500 is level 4
  });
});
