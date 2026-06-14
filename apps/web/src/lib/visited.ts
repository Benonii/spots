import type { VisitedEntry } from "./types";

const KEY = "addis-date-spots:visited";

export function loadVisited(): VisitedEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as VisitedEntry[];
  } catch {
    /* ignore corrupt/unavailable storage */
  }
  return [];
}

export function saveVisited(v: VisitedEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
