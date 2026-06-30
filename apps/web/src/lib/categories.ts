import type { Spot } from "./types";

/**
 * Curated category → tags map, derived from the LLM tag vocabulary in the data.
 * A category matches a spot if any of its tags appears in the spot's tags. This
 * bridges multi-tag concepts like "Habesha" (ethiopian + traditional + kitfo…)
 * that no single tag captures. Tunable as the tag vocabulary grows.
 */
export type Category = { key: string; label: string; tags: string[] };

export const CATEGORIES: Category[] = [
  {
    key: "habesha",
    label: "Habesha",
    tags: ["ethiopian", "traditional", "kitfo", "tibs", "injera", "shiro", "fasting", "fir-fir", "doro", "beyaynetu", "habesha", "local"],
  },
  { key: "cafe", label: "Cafe", tags: ["cafe", "coffee", "espresso", "tea"] },
  { key: "burgers", label: "Burgers", tags: ["burger"] },
  {
    key: "fastfood",
    label: "Fast food",
    tags: ["fast-food", "takeaway", "sandwich", "wrap", "chicken", "fries", "combo", "hotdog", "street-food"],
  },
  { key: "pizza", label: "Pizza & Italian", tags: ["pizza", "italian", "pasta"] },
  {
    key: "dessert",
    label: "Dessert & Pastry",
    tags: ["dessert", "bakery", "cake", "pastry", "cheesecake", "chocolate", "ice-cream", "donut", "cookie"],
  },
  { key: "grill", label: "Grill & Steak", tags: ["steak", "bbq", "grill", "meat", "roast"] },
  // source filter (not a cuisine): spots imported from the @me_says channel
  { key: "me_says", label: "me_says", tags: ["me_says"] },
  // type/amenity filters
  { key: "activity", label: "Activity", tags: ["activity"] },
  { key: "outlets", label: "Outlets available", tags: ["sockets", "outlet", "outlets", "power", "outlet_available", "outlets_available"] },
];

/** True if the spot belongs to any of the selected categories (empty = all pass). */
export function matchesCategories(spot: Spot, selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  const spotTags = new Set(spot.tags.map((t) => t.toLowerCase()));
  return CATEGORIES.some(
    (c) => selected.has(c.key) && c.tags.some((t) => spotTags.has(t)),
  );
}
