/**
 * Area grouping for the neighborhood filter.
 *
 * `neighborhood` is free text extracted by the LLM from review videos, so one
 * real-world area arrives under many strings: "4 kilo", "4 Kilo", "Arat Kilo"
 * (the Amharic name), "4 Kilo (Abrehot)" (a landmark qualifier), and sometimes
 * the whole thing in Ethiopic script. 339 spots produced 170 distinct strings —
 * a dropdown of 170 entries where a third are spelling drift is not a filter.
 *
 * So the filter runs on a hand-curated canonical set (~59 areas) while the raw
 * string stays on the card, in Places we've been, and in the editor. A spot
 * labelled "Bole (behind Medhanialem Church)" still says that on its badge; it
 * just files under "Bole".
 *
 * Curated by hand on purpose. Which of "Semit" and "Summit" are the same place,
 * and whether Arada is part of 4 Kilo, are local-knowledge questions no
 * normalizer answers — Benoni decided both (same / not the same, respectively).
 */

/**
 * canonical label → every raw string that files under it.
 *
 * Variants are matched case- and whitespace-insensitively, and a raw string
 * whose parentheses-stripped form matches also files here, so
 * "Summit (anything new)" lands on Summit without an entry. Add entries only
 * when the bare stem alone can't get there — a different spelling ("Micheal"),
 * a different name for the same place ("Arat Kilo"), or Ethiopic script.
 */
export const AREA_FAMILIES: Record<string, string[]> = {
  Bole: [
    "Bole",
    "Bole Dembel",
    "Bole ednamall",
    "Edna Mall",
    "Bole imperial",
    "Bole Matemiya",
    "Bole Mega",
    "Bole Medhanialem",
    "Bole Michael",
    "Bole Micheal",
    "ጋዜቦ አደበባይ",
    // Multi-branch strings file under the first area listed. Splitting them so
    // one spot appears under three filters reads as three spots.
    "Bole; Summit",
    "Bole; Meskel Adebabay; 5 Kilo (multiple branches)",
  ],
  "Bole Atlas": ["Bole Atlas", "Atlas", "Chechnya", "Chichiniya", "Mega, Atlas"],
  "Bole Bulbula": ["Bole Bulbula", "Bulbula"],
  "Bole Japan": ["Bole Japan"],
  "Bole Rwanda": ["Bole Rwanda", "Bole Rewanda", "Bole Riwonda"],
  "Wello Sefer": [
    "Wello Sefer",
    "Welo Sefer",
    "Wollo Sefer",
    "Bole Wello",
    "Bole Welo Sefer",
    "Bole Wollo Sefer",
  ],
  Gerji: ["Gerji"],
  Ayat: ["Ayat"],
  Megenagna: ["Megenagna", "Mergenagna"],
  Kazanchis: ["Kazanchis", "Behind AICC Convention Center"],
  // Benoni: Semit and Summit are the same area. Both spellings are in the wild,
  // and "Fiyel Bet" showed up under each — that's what settled it.
  Summit: [
    "Summit",
    "Semit",
    "Sumit",
    "Bole (Summit area)",
    "ሰሚት ሰላሳ ሜትር",
    "ፍየል ቤት ከዊነር አጠገብ",
  ],
  Mexico: ["Mexico", "Sengatera", "Senga Tera"],
  Piassa: ["Piassa", "Piazza"],
  "4 Kilo": ["4 Kilo", "4kilo", "Arat Kilo", "Aratkilo", "Arada (Arat Kilo)"],
  "5 Kilo": ["5 Kilo", "5kilo", "Amist Kilo"],
  // Benoni: Arada sits between 4 Kilo and Piassa — its own area, not a synonym.
  // "Arada (Arat Kilo)" is the one spot that names 4 Kilo outright, so it goes there.
  Arada: ["Arada"],
  Mekanisa: ["Mekanisa", "መካኒሳ አቦ ማዞሪያ አቦ ጋርደን"],
  "Meskel Flower": ["Meskel Flower", "Road Tolo"],
  "Meskel Square": ["Meskel Square", "Meskel Adebabay"],
  "22": ["22", "22ከአዲሱ ስታዲየም ወደ አዲስ ሂወት ሆስፒታል መንገድ"],
  Bitanya: ["Bitanya"],
  Kera: ["Kera"],
  Lebu: ["Lebu"],
  Betel: ["Betel", "Betel Mina Mall"],
  "Bisrate Gebriel": ["Bisrate Gebriel", "Bisrat Gebriel", "Bisrate Gabriel"],
  Jemo: ["Jemo", "ጀሞ ሚካኤል"],
  Kebena: ["Kebena"],
  Lafto: ["Lafto"],
  Sarbet: ["Sarbet"],
  CMC: ["CMC"],
  Gofa: ["Gofa"],
  Lideta: ["Lideta", "Ledeta"],
  Merkato: ["Merkato", "Merakto"],
  "Adisu Gebeya": ["Adisu Gebeya", "Adisu Gebiya"],
  Ferensay: ["Ferensay", "Kuas Meda", "ፈረንሳይ ማዞርያ"],
  Figa: ["Figa", "Goro to Figa Road"],
  Ayertena: ["Ayertena"],
  "Addis Sefer": ["Addis Sefer"],
  Beu: ["Beu"],
  Entoto: ["Entoto"],
  Filwoha: ["Filwoha"],
  Furi: ["Furi", "Furi Bajaj tera"],
  Garad: ["Garad"],
  Gulele: ["Gulele"],
  "Habte Giyorgis": ["Habte Giyorgis"],
  Hayahulet: ["Hayahulet"],
  Hayat: ["Hayat"],
  Hidar: ["Hidar"],
  Lancha: ["Lancha"],
  Meri: ["Meri"],
  "Bedriya City Mall": ["Bedriya City Mall"],
  Stadium: ["Stadium"],
  "Tulu Dimtu": ["Tulu Dimtu"],
  Urael: ["Urael"],
  Zenebwork: ["Zenebwork"],
  // Out-of-town day trips. Kept apart so a Bishoftu weekend never reads as Addis.
  Bishoftu: ["Bishoftu", "Debre Zeit", "Debre Zeyit", "Debrezeit", "Babogaya"],
  Adama: ["Adama"],
  "Arba Minch": ["Arba Minch", "Arbaminch"],
  Hawassa: ["Hawassa"],
};

export const ALL_AREAS = "All areas";

/**
 * Lowercase, drop Latin punctuation, collapse whitespace. Ethiopic passes
 * through unchanged — lowercasing does nothing for it, so those strings only
 * ever match by being listed verbatim in a family.
 *
 * Brackets go too, which is what lets "Bole (Bulbula & Gazebo Square)" reach
 * Bole Bulbula: the qualifier names the real area more precisely than the stem.
 */
function norm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[().,;/&'"-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Longest-first so "bole bulbula" is tested before "bole". */
const LOOKUP: [string, string][] = Object.entries(AREA_FAMILIES)
  .flatMap(([canonical, variants]) =>
    variants.map((v) => [norm(v), canonical] as [string, string]),
  )
  .sort((a, b) => b[0].length - a[0].length);

const EXACT = new Map(LOOKUP.map(([variant, canonical]) => [variant, canonical]));

/**
 * The canonical area a raw neighborhood string files under.
 *
 * Three passes, cheapest first: exact variant, variant with the parenthetical
 * qualifier dropped, then a stem match so an unseen "Summit 40 meter" still
 * finds Summit. A string that matches nothing is returned trimmed rather than
 * dropped — a new area should appear in the filter, not vanish from it.
 */
export function canonicalArea(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const full = norm(raw);
  if (!full) return null;
  // The full string first — a qualifier often carries the real area
  // ("Bole (Bulbula & Gazebo Square)" is Bole Bulbula, not Bole). Only when
  // nothing matches does the qualifier get dropped and the stem tried alone.
  const hit = resolve(full) ?? resolve(norm(raw.replace(/\(.*?\)/g, " ")));
  return hit ?? raw.trim() ?? null;
}

function resolve(s: string): string | null {
  const exact = EXACT.get(s);
  if (exact) return exact;
  for (const [variant, canonical] of LOOKUP) {
    // Word-boundary prefix only, longest variant first, so "Bole Bulbula
    // Maryam Mazorya" reaches Bole Bulbula rather than stopping at Bole.
    if (s.startsWith(`${variant} `)) return canonical;
  }
  return null;
}

/** The canonical areas present in a spot list, alphabetical, with `All areas` first. */
export function areaOptions(neighborhoods: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const n of neighborhoods) {
    const c = canonicalArea(n);
    if (c) found.add(c);
  }
  return [ALL_AREAS, ...Array.from(found).sort((a, b) => a.localeCompare(b))];
}

/**
 * Everything a search box should match for a canonical area: the label plus the
 * variants that are genuine synonyms, so typing "piazza" finds Piassa and
 * "arat kilo" finds 4 Kilo.
 *
 * Variants that name a *different* area are dropped. Some entries exist only to
 * route an odd string ("Bole; Summit" → Bole, "Bole (Summit area)" → Summit);
 * left in, they make "bole" match Summit and "summit" match Bole, which is how
 * a filter loses your trust. A variant may still name this area's own parent —
 * "Bole Bulbula" keeps its "Bole" — since that match is the one you meant.
 */
const SEARCH_TEXT: Record<string, string> = Object.fromEntries(
  Object.entries(AREA_FAMILIES).map(([canonical, variants]) => {
    const foreign = Object.keys(AREA_FAMILIES).filter(
      (other) => other !== canonical && !norm(canonical).startsWith(`${norm(other)} `),
    );
    const mentionsAnother = (variant: string) => {
      const words = ` ${norm(variant)} `;
      return foreign.some((other) => words.includes(` ${norm(other)} `));
    };
    return [canonical, [canonical, ...variants.filter((v) => !mentionsAnother(v))].join(" ").toLowerCase()];
  }),
);

export function areaSearchText(canonical: string): string {
  return SEARCH_TEXT[canonical] ?? canonical.toLowerCase();
}

/**
 * Rank a spot's neighborhood against the selected canonical area.
 *   0 — the spot names the area outright ("Bole")
 *   1 — the spot names a qualified form of it ("Bole (Hadere Mall)")
 *   null — a different area (excluded)
 *
 * The tiers only order results; both are matches.
 */
export function areaTier(
  neighborhood: string | null | undefined,
  selected: string,
): number | null {
  const canonical = canonicalArea(neighborhood);
  if (canonical !== selected) return null;
  return norm(neighborhood ?? "") === norm(selected) ? 0 : 1;
}
