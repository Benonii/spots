import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Dimensions, Spot } from "../lib/types";
import { ETB, PRICE_LABELS, PRICE_RANGE_TEXT, coverImage, mapsUrl } from "../lib/format";
import { StarMeter } from "./Stars";

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-2.6-2.6c.27 0 .53.04.78.12V9.79a5.7 5.7 0 0 0-.78-.05 5.69 5.69 0 1 0 5.69 5.69V9.01a7.34 7.34 0 0 0 4.3 1.38V7.3a4.3 4.3 0 0 1-3.24-1.48z" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={dir === "left" ? "M10 4 6 8l4 4" : "M6 4l4 4-4 4"} />
    </svg>
  );
}

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

/* ---------- map: Google Maps Embed (free, no per-load billing) when a key is
   configured, else the Leaflet/CARTO fallback ---------- */
const MAPS_EMBED_KEY = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY;

function GoogleMap({ spot }: { spot: Spot }) {
  const src =
    `https://www.google.com/maps/embed/v1/place?key=${MAPS_EMBED_KEY}` +
    `&q=place_id:${spot.google_place_id}&zoom=15`;
  return (
    <iframe
      className="map-el"
      title={`Map of ${spot.name}`}
      src={src}
      loading="lazy"
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

function MapPanel({ spot }: { spot: Spot }) {
  return MAPS_EMBED_KEY ? <GoogleMap spot={spot} /> : <LeafletMap spot={spot} />;
}

const TILE = {
  url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  attr: "© OpenStreetMap, © CARTO",
};

function LeafletMap({ spot }: { spot: Spot }) {
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

  const coverChildren = (
    <>
      <span className="cover-area">{spot.neighborhood ?? "Addis Ababa"}</span>
      <span className="cover-count">
        {spot.video_count} TikTok {spot.video_count === 1 ? "review" : "reviews"}
      </span>
    </>
  );
  const coverStyle = { backgroundImage: coverImage(spot) };

  return (
    <div className="spotcard">
      {spot.source_video_url ? (
        <a
          className="spot-cover"
          style={coverStyle}
          href={spot.source_video_url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Watch ${spot.name} on TikTok`}
        >
          {coverChildren}
        </a>
      ) : (
        <div className="spot-cover" style={coverStyle}>
          {coverChildren}
        </div>
      )}

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

        <div className="spot-actions">
          {spot.source_video_url && (
            <a
              className="action-btn"
              href={spot.source_video_url}
              target="_blank"
              rel="noreferrer"
            >
              <TikTokIcon /> Watch
            </a>
          )}
          <a className="action-btn" href={mapsUrl(spot)} target="_blank" rel="noreferrer">
            <MapPinIcon /> Map
          </a>
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
            <Chevron dir="left" />
          </button>
          <span className="nav-count">
            {index + 1} <i>of</i> {total}
          </span>
          <button className="navbtn" onClick={onNext} aria-label="Next">
            <Chevron dir="right" />
          </button>
        </div>
      </div>

      <div className="spot-right">
        <MapPanel spot={spot} />
      </div>
    </div>
  );
}
