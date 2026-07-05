import { describe, expect, test } from "bun:test";
import { areaTier, baseArea } from "./areas";

describe("baseArea", () => {
  test("strips parenthetical qualifiers and case", () => {
    expect(baseArea("4 Kilo (Abrehot)")).toBe("4 kilo");
    expect(baseArea("Bole (Rwanda)")).toBe("bole");
    expect(baseArea("4 kilo")).toBe("4 kilo");
  });

  test("folds aliases", () => {
    expect(baseArea("Arat Kilo")).toBe("4 kilo");
    expect(baseArea("Aratkilo")).toBe("4 kilo");
    expect(baseArea("Piazza")).toBe("piassa");
    expect(baseArea("Wollo Sefer")).toBe("wello sefer");
    expect(baseArea("5kilo")).toBe("5 kilo");
  });

  test("null/empty in, null out", () => {
    expect(baseArea(null)).toBeNull();
    expect(baseArea("")).toBeNull();
  });
});

describe("areaTier", () => {
  test("exact filter match ranks first", () => {
    expect(areaTier("4 Kilo (Abrehot)", "4 Kilo (Abrehot)")).toBe(0);
  });

  test("bare base area ranks second", () => {
    expect(areaTier("4 Kilo", "4 Kilo (Abrehot)")).toBe(1);
    expect(areaTier("4 kilo", "4 Kilo (Abrehot)")).toBe(1);
    expect(areaTier("Arat Kilo", "4 Kilo (Abrehot)")).toBe(1);
  });

  test("other qualified variants rank third", () => {
    expect(areaTier("4 Kilo (Ambassador Gerba)", "4 Kilo (Abrehot)")).toBe(2);
    expect(areaTier("4 Kilo (Ambassador Gerba)", "4 Kilo")).toBe(2);
    expect(areaTier("Bole Atlas", "Bole")).toBe(2);
    expect(areaTier("Bole (Medhanealem)", "Bole")).toBe(2);
  });

  test("selecting a bare filter still ranks it 0", () => {
    expect(areaTier("4 Kilo", "4 Kilo")).toBe(0);
    expect(areaTier("Arat Kilo", "Arat Kilo")).toBe(0);
  });

  test("unrelated areas are excluded", () => {
    expect(areaTier("Gerji", "4 Kilo")).toBeNull();
    expect(areaTier("Atlas", "Bole Atlas")).toBeNull(); // parent doesn't match child filter
    expect(areaTier(null, "4 Kilo")).toBeNull();
  });

  test("qualified selection does not leak into siblings", () => {
    // "Bole Atlas" selected must not match plain "Bole" spots upward…
    expect(areaTier("Bole", "Bole Atlas")).toBeNull();
    // …but "Bole" selected pulls "Bole Atlas" down as tier 2 (covered above).
  });
});
