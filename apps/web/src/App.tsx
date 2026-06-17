import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import type { Spot, VisitedEntry, VisitPatch } from "./lib/types";
import { fetchSpots } from "./lib/supabase";
import {
  createVisit,
  deleteVisit,
  deleteVisitsByPlace,
  fetchVisits,
  migrateLegacyVisits,
  updateVisit,
} from "./lib/visits";
import { CATEGORIES, matchesCategories } from "./lib/categories";
import { Dropdown, type Option } from "./components/Dropdown";
import { DiceButton } from "./components/DiceButton";
import { SpotCard } from "./components/SpotCard";
import { VisitedTable } from "./components/VisitedTable";

const PRICE_OPTIONS: Option[] = [
  { value: "any", label: "Any price" },
  { value: "1", label: "$ · under 300" },
  { value: "2", label: "$$ · 300–700" },
  { value: "3", label: "$$$ · 700–1,500" },
  { value: "4", label: "$$$$ · over 1,500" },
];

const SORT_OPTIONS: Option[] = [
  { value: "quality", label: "Highest rated" },
  { value: "price-asc", label: "Price · low to high" },
  { value: "price-desc", label: "Price · high to low" },
  { value: "name", label: "Name · A–Z" },
  { value: "recent", label: "Recently added" },
];

const COMPARATORS: Record<string, (a: Spot, b: Spot) => number> = {
  quality: (a, b) => b.quality_score - a.quality_score,
  "price-asc": (a, b) => (a.price_min ?? 0) - (b.price_min ?? 0),
  "price-desc": (a, b) => (b.price_min ?? 0) - (a.price_min ?? 0),
  name: (a, b) => a.name.localeCompare(b.name),
  recent: (a, b) =>
    new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime(),
};

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M13 13l-2.7-2.7" />
    </svg>
  );
}

function ChevIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s ease" }}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function App() {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [area, setArea] = useState("All areas");
  const [price, setPrice] = useState("any");
  const [sort, setSort] = useState("quality");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const chipsRef = useRef<HTMLElement>(null);
  const [chipFade, setChipFade] = useState({ left: false, right: false });
  const [visited, setVisited] = useState<VisitedEntry[]>([]);
  const [writeError, setWriteError] = useState<string | null>(null);

  const reportWriteError = useCallback((e: unknown) => {
    setWriteError(e instanceof Error ? e.message : String(e));
  }, []);

  useEffect(() => {
    fetchSpots()
      .then(setSpots)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // load our visit log from the DB (importing any legacy localStorage log once)
  useEffect(() => {
    fetchVisits()
      .then(async (rows) => {
        const migrated = await migrateLegacyVisits(rows);
        setVisited(migrated.length ? [...migrated, ...rows] : rows);
      })
      .catch(reportWriteError);
  }, [reportWriteError]);

  // show a *random* spot on every page load (not just the first), once spots arrive
  const pickedRandom = useRef(false);
  useEffect(() => {
    if (pickedRandom.current || !spots || !spots.length) return;
    pickedRandom.current = true;
    setIndex(Math.floor(Math.random() * spots.length));
  }, [spots]);

  const spotsById = useMemo(
    () =>
      Object.fromEntries((spots ?? []).map((s) => [s.google_place_id, s])) as Record<
        string,
        Spot
      >,
    [spots],
  );

  const neighborhoods = useMemo(() => {
    const names = (spots ?? [])
      .map((s) => s.neighborhood)
      .filter((n): n is string => n != null);
    return ["All areas", ...Array.from(new Set(names)).sort()];
  }, [spots]);

  const fuse = useMemo(
    () =>
      new Fuse(spots ?? [], {
        keys: ["name", "summary", "neighborhood", "tags"],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [spots],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    let list: Spot[] = q ? fuse.search(q).map((r) => r.item) : (spots ?? []).slice();
    if (area !== "All areas") list = list.filter((s) => s.neighborhood === area);
    if (price !== "any") list = list.filter((s) => s.price_level === Number(price));
    if (categories.size) list = list.filter((s) => matchesCategories(s, categories));
    return list.sort(COMPARATORS[sort] ?? COMPARATORS.quality);
  }, [spots, fuse, query, area, price, categories, sort]);

  // reset position when the filter set changes
  useEffect(() => {
    setIndex(0);
  }, [area, price, sort, query, categories]);

  const total = filtered.length;
  const current: Spot | null = total
    ? filtered[Math.min(index, total - 1)] ?? null
    : null;

  const go = useCallback(
    (delta: number) => {
      if (!total) return;
      setIndex((i) => (i + delta + total) % total);
    },
    [total],
  );

  const surprise = useCallback(() => {
    if (!total) return;
    const visitedIds = new Set(visited.map((v) => v.placeId));
    let pool = filtered
      .map((s, i) => [s, i] as const)
      .filter(([s]) => !visitedIds.has(s.google_place_id));
    if (!pool.length) pool = filtered.map((s, i) => [s, i] as const);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) setIndex(pick[1]);
  }, [filtered, total, visited]);

  const isVisited = current
    ? visited.some((v) => v.placeId === current.google_place_id)
    : false;

  const toggleVisited = useCallback(() => {
    if (!current) return;
    const placeId = current.google_place_id;
    if (visited.some((v) => v.placeId === placeId)) {
      setVisited((prev) => prev.filter((v) => v.placeId !== placeId)); // optimistic
      deleteVisitsByPlace(placeId).catch(reportWriteError);
    } else {
      createVisit({
        placeId,
        name: current.name,
        visitedAt: new Date().toISOString().slice(0, 10),
      })
        .then((entry) => setVisited((prev) => [entry, ...prev]))
        .catch(reportWriteError);
    }
  }, [current, visited, reportWriteError]);

  // Coalesce rapid edits (slider drags, note typing) into one DB write per row.
  const pendingPatch = useRef<Map<string, VisitPatch>>(new Map());
  const writeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const updateVisited = useCallback(
    (id: string, patch: VisitPatch) => {
      setVisited((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v))); // optimistic
      pendingPatch.current.set(id, { ...pendingPatch.current.get(id), ...patch });
      clearTimeout(writeTimers.current.get(id));
      writeTimers.current.set(
        id,
        setTimeout(() => {
          const p = pendingPatch.current.get(id);
          pendingPatch.current.delete(id);
          writeTimers.current.delete(id);
          if (p) updateVisit(id, p).catch(reportWriteError);
        }, 400),
      );
    },
    [reportWriteError],
  );

  const removeVisited = useCallback(
    (id: string) => {
      setVisited((prev) => prev.filter((v) => v.id !== id)); // optimistic
      deleteVisit(id).catch(reportWriteError);
    },
    [reportWriteError],
  );

  const toggleCategory = useCallback((key: string) => {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setArea("All areas");
    setPrice("any");
    setQuery("");
    setCategories(new Set());
  }, []);

  const activeFilters =
    (query.trim() ? 1 : 0) +
    (area !== "All areas" ? 1 : 0) +
    (price !== "any" ? 1 : 0) +
    categories.size;

  // edge fades on the category row signal there's more to scroll (mobile)
  const updateChipFade = useCallback(() => {
    const el = chipsRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setChipFade((p) => (p.left === left && p.right === right ? p : { left, right }));
  }, []);

  useEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    updateChipFade();
    el.addEventListener("scroll", updateChipFade, { passive: true });
    window.addEventListener("resize", updateChipFade);
    return () => {
      el.removeEventListener("scroll", updateChipFade);
      window.removeEventListener("resize", updateChipFade);
    };
  }, [updateChipFade, spots]);

  // keyboard arrows
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [go]);

  if (error) {
    return (
      <div className="appstate">
        <h2>Couldn't load spots</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!spots) {
    return (
      <div className="appstate">
        <p>Loading spots…</p>
      </div>
    );
  }
  if (!spots.length) {
    return (
      <div className="appstate">
        <h2>No spots yet</h2>
        <p>
          Run the ingestion pipeline (<code>df ingest</code>) to populate the spots table.
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-text">
            <h1>Where to next</h1>
            <p>Date spots around Addis · sourced from the people who actually went</p>
          </div>
        </div>
        <div className="brand-count">
          {spots.length} places · {visited.length} visited
        </div>
      </header>

      <div className="filtermenu">
        {filtersOpen && (
          <div className="filter-scrim" onClick={() => setFiltersOpen(false)} aria-hidden="true" />
        )}
        <div className="filtertop">
          <button
            className="filterbar"
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
          >
            <span className="filterbar-label">
              <SearchIcon /> Search &amp; filters
              {activeFilters > 0 && <span className="filterbar-badge">{activeFilters}</span>}
            </span>
            <ChevIcon open={filtersOpen} />
          </button>
          <span className="surprise-wrap surprise-mobile">
            <DiceButton onClick={surprise} />
          </span>
        </div>

        <div className={"filters-collapse" + (filtersOpen ? " open" : "")}>
          <div className="filters-inner">
      <section className="controls">
        <div className="ctrl ctrl-search">
          <label>Search</label>
          <input
            className="search-input"
            type="text"
            placeholder="rooftop coffee, quiet date…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="ctrl">
          <label>Area</label>
          <Dropdown
            value={area}
            onChange={setArea}
            options={neighborhoods.map((n) => ({ value: n, label: n }))}
          />
        </div>
        <div className="ctrl">
          <label>Price</label>
          <Dropdown value={price} onChange={setPrice} options={PRICE_OPTIONS} />
        </div>
        <div className="ctrl">
          <label>Sort by</label>
          <Dropdown value={sort} onChange={setSort} options={SORT_OPTIONS} />
        </div>
        <div className="ctrl-spacer" />
        <span className="surprise-wrap surprise-desktop">
          <DiceButton onClick={surprise} />
        </span>
      </section>
        </div>
      </div>
      </div>

      <section
        ref={chipsRef}
        className={
          "cat-chips" +
          (chipFade.left ? " fade-left" : "") +
          (chipFade.right ? " fade-right" : "")
        }
      >
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={"cat-chip" + (categories.has(c.key) ? " on" : "")}
            onClick={() => toggleCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </section>

      {current ? (
        <SpotCard
          spot={current}
          index={Math.min(index, total - 1)}
          total={total}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          isVisited={isVisited}
          onToggleVisited={toggleVisited}
        />
      ) : (
        <div className="noresults">
          No spots match these filters.{" "}
          <button onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      <section className="visited-section">
        <div className="vs-head">
          <h3>Places we've been</h3>
          <span className="vs-sub">
            {writeError ? (
              <span className="vs-error">Couldn't sync: {writeError}</span>
            ) : (
              <>{visited.length} logged · saved to the cloud</>
            )}
          </span>
        </div>
        <VisitedTable
          visited={visited}
          spotsById={spotsById}
          onUpdate={updateVisited}
          onRemove={removeVisited}
        />
      </section>
    </div>
  );
}
