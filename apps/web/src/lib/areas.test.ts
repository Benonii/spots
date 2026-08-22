import { describe, expect, test } from "bun:test";
import { areaOptions, areaSearchText, areaTier, canonicalArea } from "./areas";

describe("canonicalArea", () => {
  test("folds spelling drift onto one label", () => {
    expect(canonicalArea("Piazza")).toBe("Piassa");
    expect(canonicalArea("Arat Kilo")).toBe("4 Kilo");
    expect(canonicalArea("Aratkilo")).toBe("4 Kilo");
    expect(canonicalArea("4kilo")).toBe("4 Kilo");
    expect(canonicalArea("Mergenagna")).toBe("Megenagna");
    expect(canonicalArea("Merakto")).toBe("Merkato");
    expect(canonicalArea("Bole Micheal")).toBe("Bole");
  });

  test("Semit and Summit are the same area", () => {
    expect(canonicalArea("Semit Safari (in front of Agora)")).toBe("Summit");
    expect(canonicalArea("Sumit File Bet (behind Ontime restaurant)")).toBe("Summit");
    expect(canonicalArea("Summit 72")).toBe("Summit");
  });

  test("Arada stays its own area, but a spot naming 4 Kilo files there", () => {
    expect(canonicalArea("Arada")).toBe("Arada");
    expect(canonicalArea("Arada (Arat Kilo)")).toBe("4 Kilo");
  });

  test("a qualifier that names a more specific area wins over the stem", () => {
    expect(canonicalArea("Bole (Bulbula & Gazebo Square)")).toBe("Bole Bulbula");
    expect(canonicalArea("Bole (Rewanda)")).toBe("Bole Rwanda");
    expect(canonicalArea("Bole Welo Sefer")).toBe("Wello Sefer");
    // …and a qualifier that's just a landmark falls back to the stem.
    expect(canonicalArea("Bole (Hadere Mall)")).toBe("Bole");
  });

  test("Ethiopic strings resolve — lowercasing can't help them", () => {
    expect(canonicalArea("ጀሞ ሚካኤል")).toBe("Jemo");
    expect(canonicalArea("ሰሚት ሰላሳ ሜትር")).toBe("Summit");
    expect(canonicalArea("መካኒሳ አቦ ማዞሪያ አቦ ጋርደን")).toBe("Mekanisa");
  });

  test("a multi-branch string files under the first area listed", () => {
    expect(canonicalArea("Bole; Summit")).toBe("Bole");
    expect(canonicalArea("Bole; Meskel Adebabay; 5 Kilo (multiple branches)")).toBe("Bole");
  });

  test("an unseen area is kept, not dropped", () => {
    expect(canonicalArea("Somewhere New")).toBe("Somewhere New");
    expect(canonicalArea("Summit 40 meter")).toBe("Summit"); // …unless the stem is known
    expect(canonicalArea(null)).toBeNull();
    expect(canonicalArea("  ")).toBeNull();
  });
});

describe("areaOptions", () => {
  test("dedupes to canonical labels, alphabetical, All areas first", () => {
    expect(areaOptions(["Piazza", "Piassa", "Gerji", null, "Arat Kilo"])).toEqual([
      "All areas",
      "4 Kilo",
      "Gerji",
      "Piassa",
    ]);
  });
});

describe("areaSearchText", () => {
  test("carries the variants so a search box matches them", () => {
    expect(areaSearchText("Piassa")).toContain("piazza");
    expect(areaSearchText("4 Kilo")).toContain("arat kilo");
    expect(areaSearchText("Summit")).toContain("semit");
  });
});

describe("areaTier", () => {
  test("naming the area outright ranks above naming a qualified form", () => {
    expect(areaTier("Bole", "Bole")).toBe(0);
    expect(areaTier("Bole (Hadere Mall)", "Bole")).toBe(1);
    expect(areaTier("Semit", "Summit")).toBe(1); // a variant spelling is still a match
  });

  test("another area is excluded", () => {
    expect(areaTier("Gerji", "Bole")).toBeNull();
    expect(areaTier("Bole Bulbula", "Bole")).toBeNull(); // its own area now, not a child
    expect(areaTier(null, "Bole")).toBeNull();
  });
});
