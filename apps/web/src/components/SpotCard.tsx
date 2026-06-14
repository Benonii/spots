import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Dimensions, Spot } from "../lib/types";
import { ETB, PRICE_LABELS, PRICE_RANGE_TEXT, coverImage } from "../lib/format";
import { StarMeter } from "./Stars";

/* ---------- dimension breakdown ---------- */
const DIM_LABELS: [keyof Dimensions, string][] = [
  ["aesthetic", "Aesthetic"],
  ["vibe", "Vibe"],
  ["food", "Food"],
  ["value", "Value"],
  ["service", "Service"],
];

function Breakdown({ dims }: { dims: Dimensions }) {
  return (
    <div className="breakdown">
      {DIM_LABELS.map(([k, label]) => (
        <div className="bd-row" key={k}>
          <span className="bd-label">{label}</span>
          <span className="bd-track">
            <span className="bd-fill" style={{ width: (dims[k] / 5) * 100 + "%" }} />
          </span>
          <span className="bd-num">{dims[k].toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Leaflet map ---------- */
const TILE = {
  url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  attr: "© OpenStreetMap, © CARTO",
};

function MapPanel({ spot }: { spot: Spot }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // init once (StrictMode-safe: cleanup tears the map down)
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    }).setView([spot.lat, spot.lng], 14);
    mapRef.current = map;
    L.tileLayer(TILE.url, { attribution: TILE.attr, maxZoom: 19 }).addTo(map);
    const icon = L.divIcon({
      className: "spot-pin-wrap",
      html: '<span class="spot-pin"></span>',
      iconSize: [30, 30],
      iconAnchor: [15, 28],
    });
    markerRef.current = L.marker([spot.lat, spot.lng], { icon }).addTo(map);
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // recenter + move marker when the spot changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([spot.lat, spot.lng], 14, { duration: 0.8 });
    markerRef.current?.setLatLng([spot.lat, spot.lng]);
  }, [spot.id, spot.lat, spot.lng]);

  return <div className="map-el" ref={elRef} />;
}

/* ---------- main spot card ---------- */
export function SpotCard({
  spot,
  index,
  total,
  onPrev,
  onNext,
  isVisited,
  onToggleVisited,
  showBreakdown = true,
}: {
  spot: Spot;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  isVisited: boolean;
  onToggleVisited: () => void;
  showBreakdown?: boolean;
}) {
  const stars = spot.quality_score / 20;
  const dims = spot.quality_signals.dimensions;
  const hasPrice = spot.price_level != null && spot.price_min != null;
  const basisLabel = spot.price_basis === "total" ? "total" : "per person";

  return (
    <div className="spotcard">
      <div className="spot-cover" style={{ backgroundImage: coverImage(spot) }}>
        <span className="cover-area">{spot.neighborhood ?? "Addis Ababa"}</span>
        <span className="cover-count">
          {spot.video_count} TikTok {spot.video_count === 1 ? "review" : "reviews"}
        </span>
      </div>

      <div className="spot-left">
        <div className="spot-headrow">
          <h2 className="spot-name">{spot.name}</h2>
          <button className={"been-btn" + (isVisited ? " on" : "")} onClick={onToggleVisited}>
            {isVisited ? "✓ Been here" : "Mark as been"}
          </button>
        </div>

        <div className="spot-loc">
          <span className="loc-dot" />
          {spot.address ?? spot.neighborhood ?? "Addis Ababa"}
        </div>

        {spot.summary && <p className="spot-summary">{spot.summary}</p>}

        <div className="spot-tags">
          {spot.tags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
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
            {hasPrice ? (
              <>
                <div className="price-line">
                  <span className="price-dots">
                    <b>{PRICE_LABELS[spot.price_level!]}</b>
                    <i>{"$$$$".slice(spot.price_level!)}</i>
                  </span>
                  <span className="price-val">
                    ETB {ETB(spot.price_min!)}
                    {spot.price_max ? "–" + ETB(spot.price_max) : ""}
                  </span>
                </div>
                <div className="meta-sub">
                  {basisLabel} · {PRICE_RANGE_TEXT[spot.price_level!]} ETB band
                </div>
              </>
            ) : (
              <>
                <div className="price-line">
                  <span className="price-val" style={{ color: "var(--muted)" }}>
                    No price data
                  </span>
                </div>
                <div className="meta-sub">not enough signal in the reviews yet</div>
              </>
            )}
          </div>
        </div>

        <div className="spot-nav">
          <button className="navbtn" onClick={onPrev} aria-label="Previous">
            ‹
          </button>
          <span className="nav-count">
            {index + 1} <i>of</i> {total}
          </span>
          <button className="navbtn" onClick={onNext} aria-label="Next">
            ›
          </button>
        </div>
      </div>

      <div className="spot-right">
        <MapPanel spot={spot} />
      </div>
    </div>
  );
}
