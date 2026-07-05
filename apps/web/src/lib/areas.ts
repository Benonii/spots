/**
 * Area grouping for the neighborhood filter.
 *
 * `neighborhood` is free text extracted by the LLM from review videos, so one
 * real-world area shows up under many strings: "4 kilo", "4 Kilo",
 * "4 Kilo (Abrehot)", "Arat Kilo" (the Amharic name). Selecting a filter
 * should surface the whole family, ranked by how specific the match is,
 * without collapsing the distinct dropdown entries.
 */

/**
 * Whole-string aliases applied after normalization: Amharic/Latin name pairs
 * and spelling drift observed in the data. Keys and values are normalized
 * (lowercase, single spaces). Extend as new variants appear.
 */
const ALIASES: Record<string, string> = {
  "arat kilo": "4 kilo",
  aratkilo: "4 kilo",
  "amist kilo": "5 kilo",
  "5kilo": "5 kilo",
  piazza: "piassa",
  "welo sefer": "wello sefer",
  "wollo sefer": "wello sefer",
  "bisrate gabriel": "bisrate gebriel",
  mergenagna: "megenagna",
};

/** Lowercase, collapse whitespace, then fold known aliases. */
function norm(raw: string): string {
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  return ALIASES[s] ?? s;
}

/**
 * The base area of a neighborhood string: parenthetical qualifiers stripped,
 * normalized, aliased. "4 Kilo (Abrehot)" → "4 kilo", "Arat Kilo" → "4 kilo".
 */
export function baseArea(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return norm(raw.replace(/\(.*?\)/g, " ")) || null;
}

/**
 * Rank a spot's neighborhood against the selected area filter.
 *   0 — exactly the selected filter string
 *   1 — the bare base area ("4 Kilo" / "Arat Kilo" when any 4-kilo filter is selected)
 *   2 — same base with another qualifier ("4 Kilo (Ambassador Gerba)", "Bole Atlas")
 *   null — a different area entirely (excluded from results)
 */
export function areaTier(neighborhood: string | null | undefined, selected: string): number | null {
  if (!neighborhood) return null;
  if (neighborhood === selected) return 0;
  const base = baseArea(selected);
  const spotBase = baseArea(neighborhood);
  if (!base || !spotBase) return null;
  if (norm(neighborhood) === base) return 1;
  if (spotBase === base || spotBase.startsWith(`${base} `)) return 2;
  return null;
}
