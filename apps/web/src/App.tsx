import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import Fuse from "fuse.js";
import type { User } from "@supabase/supabase-js";
import type { CommunityVisit, Spot, VisitedEntry, VisitPatch } from "./lib/types";
import { fetchSpots, signInWithGoogle, signOut, supabase } from "./lib/supabase";
import {
  createVisit,
  deleteVisit,
  deleteVisitsByPlace,
  fetchCommunityVisits,
  fetchVisits,
  migrateLegacyVisits,
  updateVisit,
} from "./lib/visits";
import { upsertProfile } from "./lib/profiles";
import { addSaved, fetchSaved, removeSaved } from "./lib/saved";
import { CATEGORIES, matchesCategories } from "./lib/categories";
import { PRICE_LABELS } from "./lib/format";
import { Dropdown, type Option } from "./components/Dropdown";
import { DiceButton } from "./components/DiceButton";
import { SpotCard } from "./components/SpotCard";
import { VisitedTable } from "./components/VisitedTable";
import { CommunityTable } from "./components/CommunityTable";
import { AuthButton } from "./components/AuthButton";
import { BrandMark } from "./components/BrandMark";

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

function NearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
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

/** Map any thrown value to safe, human copy — raw errors (TypeError, "Failed to
 * fetch", stacks) must never reach the UI in production. */
function friendlyError(e: unknown): string {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const msg = e instanceof Error ? e.message : String(e);
  if (offline || /fail(ed)? to fetch|networkerror|network request|load failed/i.test(msg)) {
    return "You're offline — changes will sync when you reconnect.";
  }
  return "Couldn't save your changes. Please try again.";
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
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savedOpen, setSavedOpen] = useState(() => {
    try {
      return localStorage.getItem("spots:wishOpen") !== "0";
    } catch {
      return true;
    }
  });
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [community, setCommunity] = useState<CommunityVisit[]>([]);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const reportWriteError = useCallback((e: unknown) => {
    if (import.meta.env.DEV) console.warn("write error:", e); // detail for devs only
    setWriteError(friendlyError(e));
  }, []);

  const loadSpots = useCallback(() => {
    setError(null);
    fetchSpots()
      .then(setSpots)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    loadSpots();
  }, [loadSpots]);

  // Auto-recover when the connection comes back, but only if we failed or never
  // loaded — no need to re-fetch when spots are already on screen.
  useEffect(() => {
    const onOnline = () => {
      setWriteError(null); // drop any stale "you're offline" notice
      if (error || !spots) loadSpots();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [error, spots, loadSpots]);

  // track the Google session (and the OAuth redirect back into the app)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // load the signed-in user's own log (importing any legacy localStorage log
  // once) plus everyone's public reviews; mirror their Google profile so their
  // reviews show a name + avatar. All cleared when signed out.
  useEffect(() => {
    if (!user) {
      setVisited([]);
      setSaved(new Set());
      setCommunity([]);
      return;
    }
    void upsertProfile(user).catch(() => {}); // best-effort; don't block the log
    fetchVisits(user.id)
      .then(async (rows) => {
        const migrated = await migrateLegacyVisits(rows);
        setVisited(migrated.length ? [...migrated, ...rows] : rows);
        setWriteError(null); // sync succeeded — clear any prior notice
      })
      .catch(reportWriteError);
    fetchSaved(user.id).then((ids) => setSaved(new Set(ids))).catch(reportWriteError);
    // community feed is non-critical — never let it block or error the log
    fetchCommunityVisits()
      .then(setCommunity)
      .catch((e) => console.warn("community feed unavailable:", e));
  }, [user, reportWriteError]);

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

  // land on a "want to go" target once it appears in the filtered list
  useEffect(() => {
    if (!pendingTarget) return;
    const idx = filtered.findIndex((s) => s.google_place_id === pendingTarget);
    if (idx >= 0) {
      setIndex(idx);
      setPendingTarget(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [pendingTarget, filtered]);

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
  const isSaved = current ? saved.has(current.google_place_id) : false;

  const toggleSaved = useCallback(() => {
    if (!user) {
      void signInWithGoogle().catch(reportWriteError);
      return;
    }
    if (!current) return;
    const placeId = current.google_place_id;
    const has = saved.has(placeId);
    setSaved((prev) => {
      const next = new Set(prev);
      if (has) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
    (has ? removeSaved(placeId) : addSaved(placeId)).catch(reportWriteError);
  }, [user, current, saved, reportWriteError]);

  const toggleSavedOpen = useCallback(() => {
    setSavedOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem("spots:wishOpen", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const removeSavedSpot = useCallback(
    (placeId: string) => {
      setSaved((prev) => {
        const next = new Set(prev);
        next.delete(placeId);
        return next;
      });
      removeSaved(placeId).catch(reportWriteError);
    },
    [reportWriteError],
  );

  const toggleVisited = useCallback(() => {
    if (!user) {
      void signInWithGoogle().catch(reportWriteError); // prompt sign-in, then they can mark it
      return;
    }
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
  }, [user, current, visited, reportWriteError]);

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

  const handleSignIn = useCallback(() => {
    void signInWithGoogle().catch(reportWriteError);
  }, [reportWriteError]);

  const handleSignOut = useCallback(() => {
    void signOut().catch(reportWriteError);
  }, [reportWriteError]);

  const clearFilters = useCallback(() => {
    setArea("All areas");
    setPrice("any");
    setQuery("");
    setCategories(new Set());
  }, []);

  // the saved spots, in save order, that still exist in the catalog
  const savedList = useMemo(
    () => [...saved].map((id) => spotsById[id]).filter((s): s is Spot => Boolean(s)),
    [saved, spotsById],
  );

  // jump the carousel to a specific spot (clearing filters first if it's hidden)
  const goToSpot = useCallback(
    (placeId: string) => {
      if (!filtered.some((s) => s.google_place_id === placeId)) clearFilters();
      setPendingTarget(placeId);
    },
    [filtered, clearFilters],
  );

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
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    return (
      <div className="appstate">
        <h2>{offline ? "You're offline" : "Couldn't load spots"}</h2>
        <p>
          {offline
            ? "Spots load over the network. Reconnect and try again — places you've already opened stay cached."
            : "We couldn't reach the server. Check your connection and try again."}
        </p>
        <div className="appstate-actions">
          <button className="appstate-btn" onClick={loadSpots}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!spots) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <BrandMark className="brand-mark" />
            <div className="brand-text">
              <h1>Where to next</h1>
              <p>Date spots around Addis · sourced from the people who actually went</p>
            </div>
          </div>
        </header>
        <div className="sk-card" aria-busy="true" aria-label="Loading spots…">
          <div className="sk sk-cover" />
          <div className="sk-body">
            <div className="sk sk-title" />
            <div className="sk sk-loc" />
            <div className="sk-row">
              <span className="sk sk-pill" />
              <span className="sk sk-pill" />
            </div>
            <div className="sk-lines">
              <div className="sk sk-line" />
              <div className="sk sk-line" />
              <div className="sk sk-line sk-short" />
            </div>
            <div className="sk-row sk-tags">
              <span className="sk sk-tag" />
              <span className="sk sk-tag" />
              <span className="sk sk-tag" />
            </div>
          </div>
          <div className="sk sk-map" />
        </div>
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
          <BrandMark className="brand-mark" />
          <div className="brand-text">
            <h1>Where to next</h1>
            <p>Date spots around Addis · sourced from the people who actually went</p>
            <div className="brand-count brand-count-mobile">
              {spots.length} places{user ? ` · ${visited.length} visited` : ""}
            </div>
          </div>
        </div>
        <div className="topbar-right">
          <div className="brand-count brand-count-desktop">
            {spots.length} places{user ? ` · ${visited.length} visited` : ""}
          </div>
          <Link to="/near" className="near-link">
            <NearIcon /> Near me
          </Link>
          <AuthButton user={user} onSignIn={handleSignIn} onSignOut={handleSignOut} />
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
          <label htmlFor="spot-search">Search</label>
          <input
            id="spot-search"
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
            ariaLabel="Area"
          />
        </div>
        <div className="ctrl">
          <label>Price</label>
          <Dropdown value={price} onChange={setPrice} options={PRICE_OPTIONS} ariaLabel="Price" />
        </div>
        <div className="ctrl">
          <label>Sort by</label>
          <Dropdown value={sort} onChange={setSort} options={SORT_OPTIONS} ariaLabel="Sort by" />
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
          isSaved={isSaved}
          onToggleSaved={toggleSaved}
        />
      ) : (
        <div className="noresults">
          No spots match these filters.{" "}
          <button onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      {user && savedList.length > 0 && (
        <section className="saved-section">
          <div className="vs-head">
            <h3>
              <button
                className="saved-toggle"
                onClick={toggleSavedOpen}
                aria-expanded={savedOpen}
                aria-controls="want-to-go-list"
              >
                Want to go
                <ChevIcon open={savedOpen} />
              </button>
            </h3>
            <span className="vs-sub">{savedList.length} saved</span>
          </div>
          <div
            id="want-to-go-list"
            className={"saved-collapse" + (savedOpen ? " open" : "")}
          >
          <div className="saved-list">
            {savedList.map((s) => (
              <div
                key={s.google_place_id}
                className="saved-item"
                role="button"
                tabIndex={0}
                onClick={() => goToSpot(s.google_place_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    goToSpot(s.google_place_id);
                  }
                }}
              >
                <div className="saved-main">
                  <span className="saved-name">{s.name}</span>
                  <span className="saved-meta">
                    {s.neighborhood ?? "Addis Ababa"}
                    {s.price_level != null ? ` · ${PRICE_LABELS[s.price_level]}` : ""}
                  </span>
                </div>
                <button
                  className="saved-remove"
                  aria-label={`Remove ${s.name} from your want-to-go list`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSavedSpot(s.google_place_id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          </div>
        </section>
      )}

      <section className="visited-section">
        <div className="vs-head">
          <h3>Places we've been</h3>
          <span className="vs-sub">
            {writeError ? (
              <span className="vs-error">{writeError}</span>
            ) : user ? (
              <>{visited.length} logged · saved to your account</>
            ) : (
              <>sign in to start your log</>
            )}
          </span>
        </div>
        {!user ? (
          <div className="visited-empty">
            <p style={{ margin: "0 0 14px" }}>
              Sign in to track the places you've been and save spots you want to go.
            </p>
            <button className="auth-btn" onClick={handleSignIn}>
              Sign in with Google
            </button>
          </div>
        ) : (
        <VisitedTable
          visited={visited}
          spotsById={spotsById}
          onUpdate={updateVisited}
          onRemove={removeVisited}
        />
        )}
      </section>

      {user && (
        <section className="community-section">
          <div className="vs-head">
            <h3>Community reviews</h3>
            <span className="vs-sub">
              {community.length
                ? `${community.length} review${community.length === 1 ? "" : "s"} from the community`
                : "be the first to leave a review"}
            </span>
          </div>
          <CommunityTable entries={community} spotsById={spotsById} />
        </section>
      )}
    </div>
  );
}
