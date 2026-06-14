/* Addis date-spots browser. Reads window.SPOTS (mock of the `spots` table),
   tracks visited in localStorage under addis-date-spots:visited (schemas.md §6). */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

const VISITED_KEY = "addis-date-spots:visited";
const ETB = (n) => n.toLocaleString("en-US");

const NEIGHBORHOODS = ["All areas", ...Array.from(new Set(window.SPOTS.map(s => s.neighborhood))).sort()];
const PRICE_LABELS = { 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };
const PRICE_RANGE_TEXT = { 1: "under 300", 2: "300–700", 3: "700–1,500", 4: "over 1,500" };

/* ---------- localStorage visited store ---------- */
function loadVisited() {
  try {
    const raw = localStorage.getItem(VISITED_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // seed on first load
  localStorage.setItem(VISITED_KEY, JSON.stringify(window.SEED_VISITED));
  return window.SEED_VISITED.slice();
}
function saveVisited(v) {
  try { localStorage.setItem(VISITED_KEY, JSON.stringify(v)); } catch (e) {}
}

/* ---------- custom dropdown ---------- */
function Dropdown({ value, options, onChange, align = "left" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const sel = options.find(o => o.value === value) || options[0];
  return (
    <div className={"dd" + (open ? " open" : "")} ref={ref}>
      <button type="button" className="dd-trigger" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="dd-value">{sel ? sel.label : ""}</span>
        <span className="dd-caret" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
      </button>
      {open && (
        <div className={"dd-menu dd-" + align} role="listbox">
          {options.map(o => (
            <button type="button" key={o.value} role="option" aria-selected={o.value === value}
              className={"dd-opt" + (o.value === value ? " sel" : "")}
              onClick={() => { onChange(o.value); setOpen(false); }}>
              <span className="dd-opt-label">{o.label}</span>
              <span className="dd-check">{o.value === value ? "✓" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PRICE_OPTIONS = [
  { value: "any", label: "Any price" },
  { value: "1", label: "$ · under 300" },
  { value: "2", label: "$$ · 300–700" },
  { value: "3", label: "$$$ · 700–1,500" },
  { value: "4", label: "$$$$ · over 1,500" },
];
const SORT_OPTIONS = [
  { value: "quality", label: "Highest rated" },
  { value: "price-asc", label: "Price · low to high" },
  { value: "price-desc", label: "Price · high to low" },
  { value: "name", label: "Name · A–Z" },
  { value: "recent", label: "Recently added" },
];

/* ---------- star meters ---------- */
function StarMeter({ value, max = 5, size = 20 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const row = (fill) => (
    <span style={{ color: fill, fontSize: size, lineHeight: 1, letterSpacing: size * 0.08 }}>★★★★★</span>
  );
  return (
    <span className="starmeter" style={{ height: size }}>
      <span className="starmeter-bg">{row("var(--star-empty)")}</span>
      <span className="starmeter-fg" style={{ width: pct + "%" }}>{row("var(--star-fill)")}</span>
    </span>
  );
}

function EditableStars({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <span className="edit-stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          className="edit-star"
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? 0 : n)}
          aria-label={n + " star"}
          style={{ color: (hover || value) >= n ? "var(--star-fill)" : "var(--star-empty)" }}
        >★</button>
      ))}
    </span>
  );
}

/* ---------- dimension breakdown ---------- */
const DIM_LABELS = [
  ["aesthetic", "Aesthetic"], ["vibe", "Vibe"], ["food", "Food"],
  ["value", "Value"], ["service", "Service"],
];
function Breakdown({ dims }) {
  return (
    <div className="breakdown">
      {DIM_LABELS.map(([k, label]) => (
        <div className="bd-row" key={k}>
          <span className="bd-label">{label}</span>
          <span className="bd-track"><span className="bd-fill" style={{ width: (dims[k] / 5 * 100) + "%" }} /></span>
          <span className="bd-num">{dims[k].toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Leaflet map ---------- */
const TILES = {
  warm: { url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
          attr: '© OpenStreetMap, © CARTO' },
  light: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
           attr: '© OpenStreetMap, © CARTO' },
};
function MapPanel({ spot, tileStyle }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
      .setView([spot.lat, spot.lng], 14);
    mapRef.current = map;
    const t = TILES[tileStyle] || TILES.warm;
    layerRef.current = L.tileLayer(t.url, { attribution: t.attr, maxZoom: 19 }).addTo(map);

    const icon = L.divIcon({
      className: "spot-pin-wrap",
      html: '<span class="spot-pin"></span>',
      iconSize: [30, 30], iconAnchor: [15, 28],
    });
    markerRef.current = L.marker([spot.lat, spot.lng], { icon }).addTo(map);
    setTimeout(() => map.invalidateSize(), 60);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // tile style change
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (layerRef.current) map.removeLayer(layerRef.current);
    const t = TILES[tileStyle] || TILES.warm;
    layerRef.current = L.tileLayer(t.url, { attribution: t.attr, maxZoom: 19 }).addTo(map);
  }, [tileStyle]);

  // spot change -> recenter + move marker
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    map.flyTo([spot.lat, spot.lng], 14, { duration: 0.8 });
    if (markerRef.current) markerRef.current.setLatLng([spot.lat, spot.lng]);
  }, [spot.id]);

  return <div className="map-el" ref={elRef} />;
}

/* ---------- main spot card ---------- */
function SpotCard({ spot, index, total, onPrev, onNext, isVisited, onToggleVisited, showBreakdown, tileStyle }) {
  const stars = spot.quality_score / 20;
  const dims = spot.quality_signals.dimensions;
  const basisLabel = spot.price_basis === "total" ? "total" : "per person";
  return (
    <div className="spotcard">
      <div className="spot-left">
        <div className="spot-cover" style={{ backgroundImage: spot.cover_image_url }}>
          <span className="cover-area">{spot.neighborhood}</span>
          <span className="cover-count">{spot.video_count} TikTok {spot.video_count === 1 ? "review" : "reviews"}</span>
        </div>

        <div className="spot-headrow">
          <h2 className="spot-name">{spot.name}</h2>
          <button className={"been-btn" + (isVisited ? " on" : "")} onClick={onToggleVisited}>
            {isVisited ? "✓ Been here" : "Mark as been"}
          </button>
        </div>

        <div className="spot-loc">
          <span className="loc-dot" />{spot.address}
        </div>

        <p className="spot-summary">{spot.summary}</p>

        <div className="spot-tags">
          {spot.tags.map(t => <span className="tag" key={t}>{t}</span>)}
        </div>

        <div className="spot-meta">
          <div className="meta-block">
            <div className="meta-label">Rating</div>
            <div className="rating-line">
              <StarMeter value={stars} />
              <span className="rating-num">{stars.toFixed(1)}</span>
            </div>
            <div className="meta-sub">from Google reviews + TikTok comments</div>
            {showBreakdown && <Breakdown dims={dims} />}
          </div>

          <div className="meta-block">
            <div className="meta-label">Price range</div>
            <div className="price-line">
              <span className="price-dots">
                <b>{PRICE_LABELS[spot.price_level]}</b>
                <i>{"$$$$".slice(spot.price_level)}</i>
              </span>
              <span className="price-val">ETB {ETB(spot.price_min)}{spot.price_max ? "–" + ETB(spot.price_max) : ""}</span>
            </div>
            <div className="meta-sub">{basisLabel} · {PRICE_RANGE_TEXT[spot.price_level]} ETB band</div>
          </div>
        </div>

        <div className="spot-nav">
          <button className="navbtn" onClick={onPrev} aria-label="Previous">‹</button>
          <span className="nav-count">{index + 1} <i>of</i> {total}</span>
          <button className="navbtn" onClick={onNext} aria-label="Next">›</button>
        </div>
      </div>

      <div className="spot-right">
        <MapPanel spot={spot} tileStyle={tileStyle} />
      </div>
    </div>
  );
}

/* ---------- visited table ---------- */
function VisitedTable({ visited, spotsById, onUpdate, onRemove }) {
  if (!visited.length) {
    return (
      <div className="visited-empty">No places marked yet. Mark a spot as “been” to start your log.</div>
    );
  }
  return (
    <div className="visited-table">
      <div className="vt-head">
        <span className="vt-c-place">Place</span>
        <span className="vt-c-area">Area</span>
        <span className="vt-c-price">Price</span>
        <span className="vt-c-rate">Our rating</span>
        <span className="vt-c-date">Visited</span>
        <span className="vt-c-notes">Our notes</span>
        <span className="vt-c-x" />
      </div>
      {visited.map((v) => {
        const s = spotsById[v.placeId];
        return (
          <div className="vt-row" key={v.placeId}>
            <span className="vt-c-place vt-place">{v.name}</span>
            <span className="vt-c-area">{s ? s.neighborhood : "—"}</span>
            <span className="vt-c-price">{s ? PRICE_LABELS[s.price_level] : "—"}</span>
            <span className="vt-c-rate"><EditableStars value={v.rating || 0} onChange={(r) => onUpdate(v.placeId, { rating: r })} /></span>
            <span className="vt-c-date">{v.visitedAt}</span>
            <span className="vt-c-notes">
              <textarea
                className="note-input"
                value={v.notes || ""}
                placeholder="Add a note…"
                rows={2}
                onChange={(e) => onUpdate(v.placeId, { notes: e.target.value })}
              />
            </span>
            <button className="vt-remove" onClick={() => onRemove(v.placeId)} aria-label="Remove">×</button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- app ---------- */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "mood": "balanced",
  "showBreakdown": true,
  "mapStyle": "warm"
}/*EDITMODE-END*/;

const MOODS = {
  balanced: { "--accent": "#E37B33", "--primary": "#3E5C44", "--hero-a": "#3E5C44", "--hero-b": "#E37B33" },
  forest:   { "--accent": "#7E9579", "--primary": "#2C4232", "--hero-a": "#2C4232", "--hero-b": "#6B8A5E" },
  sunset:   { "--accent": "#E8772A", "--primary": "#CF6A26", "--hero-a": "#E8772A", "--hero-b": "#EFC877" },
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const spots = window.SPOTS;
  const spotsById = useMemo(() => Object.fromEntries(spots.map(s => [s.google_place_id, s])), [spots]);

  const [area, setArea] = useState("All areas");
  const [price, setPrice] = useState("any");
  const [sort, setSort] = useState("quality");
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState(loadVisited);

  useEffect(() => { saveVisited(visited); }, [visited]);

  const filtered = useMemo(() => {
    let list = spots.slice();
    if (area !== "All areas") list = list.filter(s => s.neighborhood === area);
    if (price !== "any") list = list.filter(s => s.price_level === Number(price));
    const cmp = {
      quality: (a, b) => b.quality_score - a.quality_score,
      "price-asc": (a, b) => (a.price_min || 0) - (b.price_min || 0),
      "price-desc": (a, b) => (b.price_min || 0) - (a.price_min || 0),
      name: (a, b) => a.name.localeCompare(b.name),
      recent: (a, b) => new Date(b.first_seen_at) - new Date(a.first_seen_at),
    }[sort];
    return list.sort(cmp);
  }, [spots, area, price, sort]);

  // keep index valid when filter set changes
  useEffect(() => { setIndex(0); }, [area, price, sort]);

  const total = filtered.length;
  const current = total ? filtered[Math.min(index, total - 1)] : null;

  const go = useCallback((delta) => {
    if (!total) return;
    setIndex(i => (i + delta + total) % total);
  }, [total]);

  const surprise = useCallback(() => {
    if (!total) return;
    const visitedIds = new Set(visited.map(v => v.placeId));
    let pool = filtered.map((s, i) => [s, i]).filter(([s]) => !visitedIds.has(s.google_place_id));
    if (!pool.length) pool = filtered.map((s, i) => [s, i]);
    const [, i] = pool[Math.floor(Math.random() * pool.length)];
    setIndex(i);
  }, [filtered, total, visited]);

  const isVisited = current ? visited.some(v => v.placeId === current.google_place_id) : false;
  const toggleVisited = useCallback(() => {
    if (!current) return;
    setVisited(prev => {
      if (prev.some(v => v.placeId === current.google_place_id)) {
        return prev.filter(v => v.placeId !== current.google_place_id);
      }
      return [...prev, {
        placeId: current.google_place_id, name: current.name,
        visitedAt: new Date().toISOString().slice(0, 10), rating: 0, notes: "",
      }];
    });
  }, [current]);

  const updateVisited = useCallback((placeId, patch) => {
    setVisited(prev => prev.map(v => v.placeId === placeId ? { ...v, ...patch } : v));
  }, []);
  const removeVisited = useCallback((placeId) => {
    setVisited(prev => prev.filter(v => v.placeId !== placeId));
  }, []);

  // keyboard arrows
  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [go]);

  const rootStyle = MOODS[t.mood] || MOODS.balanced;

  return (
    <div className="app" style={rootStyle}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-text">
            <h1>Where to next</h1>
            <p>Date spots around Addis · sourced from the people who actually went</p>
          </div>
        </div>
        <div className="brand-count">{spots.length} places · {visited.length} visited</div>
      </header>

      <section className="controls">
        <div className="ctrl">
          <label>Area</label>
          <Dropdown value={area} onChange={setArea}
            options={NEIGHBORHOODS.map(n => ({ value: n, label: n }))} />
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
          spot={current} index={Math.min(index, total - 1)} total={total}
          onPrev={() => go(-1)} onNext={() => go(1)}
          isVisited={isVisited} onToggleVisited={toggleVisited}
          showBreakdown={t.showBreakdown} tileStyle={t.mapStyle}
        />
      ) : (
        <div className="noresults">No spots match these filters. <button onClick={() => { setArea("All areas"); setPrice("any"); }}>Clear filters</button></div>
      )}

      <section className="visited-section">
        <div className="vs-head">
          <h3>Places we've been</h3>
          <span className="vs-sub">{visited.length} logged · notes & ratings are ours</span>
        </div>
        <VisitedTable visited={visited} spotsById={spotsById} onUpdate={updateVisited} onRemove={removeVisited} />
      </section>

      <TweaksPanel>
        <TweakSection label="Mood" />
        <TweakRadio label="Color mood" value={t.mood}
          options={["forest", "balanced", "sunset"]}
          onChange={(v) => setTweak("mood", v)} />
        <TweakRadio label="Map style" value={t.mapStyle}
          options={["warm", "light"]}
          onChange={(v) => setTweak("mapStyle", v)} />
        <TweakSection label="Detail" />
        <TweakToggle label="Show rating breakdown" value={t.showBreakdown}
          onChange={(v) => setTweak("showBreakdown", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
