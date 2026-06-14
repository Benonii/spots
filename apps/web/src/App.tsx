import { useCallback, useEffect, useMemo, useState } from "react";
import type { Spot, VisitedEntry } from "./lib/types";
import { fetchSpots } from "./lib/supabase";
import { loadVisited, saveVisited } from "./lib/visited";
import { Dropdown, type Option } from "./components/Dropdown";
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

export function App() {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [area, setArea] = useState("All areas");
  const [price, setPrice] = useState("any");
  const [sort, setSort] = useState("quality");
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState<VisitedEntry[]>(loadVisited);

  useEffect(() => {
    fetchSpots()
      .then(setSpots)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    saveVisited(visited);
  }, [visited]);

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

  const filtered = useMemo(() => {
    let list = (spots ?? []).slice();
    if (area !== "All areas") list = list.filter((s) => s.neighborhood === area);
    if (price !== "any") list = list.filter((s) => s.price_level === Number(price));
    return list.sort(COMPARATORS[sort] ?? COMPARATORS.quality);
  }, [spots, area, price, sort]);

  // reset position when the filter set changes
  useEffect(() => {
    setIndex(0);
  }, [area, price, sort]);

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
    setVisited((prev) =>
      prev.some((v) => v.placeId === current.google_place_id)
        ? prev.filter((v) => v.placeId !== current.google_place_id)
        : [
            ...prev,
            {
              placeId: current.google_place_id,
              name: current.name,
              visitedAt: new Date().toISOString().slice(0, 10),
              rating: 0,
              notes: "",
            },
          ],
    );
  }, [current]);

  const updateVisited = useCallback((placeId: string, patch: Partial<VisitedEntry>) => {
    setVisited((prev) => prev.map((v) => (v.placeId === placeId ? { ...v, ...patch } : v)));
  }, []);

  const removeVisited = useCallback((placeId: string) => {
    setVisited((prev) => prev.filter((v) => v.placeId !== placeId));
  }, []);

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

      <section className="controls">
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
        <button className="surprise" onClick={surprise}>
          <span className="dice">⚂</span> Surprise me
        </button>
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
          <button
            onClick={() => {
              setArea("All areas");
              setPrice("any");
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      <section className="visited-section">
        <div className="vs-head">
          <h3>Places we've been</h3>
          <span className="vs-sub">{visited.length} logged · notes &amp; ratings are ours</span>
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
