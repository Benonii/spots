import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { Spot } from "./lib/types";
import { fetchSpots } from "./lib/supabase";
import { PRICE_LABELS, coverImage, mapsUrl } from "./lib/format";
import { openTikTok } from "./lib/tiktok";
import { estimateRoadKm, formatDistance, formatRoadEstimate, haversineKm, useGeolocation } from "./lib/geo";
import { BrandMark } from "./components/BrandMark";

// "Near me" caps at 10 km: past a few km it isn't really nearby, and the
// distance estimate is only calibrated/reliable within this range anyway.
const MAX_RADIUS = 10;
const RADII = [
  { value: 1, label: "1 km" },
  { value: 3, label: "3 km" },
  { value: 5, label: "5 km" },
  { value: MAX_RADIUS, label: "10 km" },
];

function BackIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 4 6 8l4 4" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-2.6-2.6c.27 0 .53.04.78.12V9.79a5.7 5.7 0 0 0-.78-.05 5.69 5.69 0 1 0 5.69 5.69V9.01a7.34 7.34 0 0 0 4.3 1.38V7.3a4.3 4.3 0 0 1-3.24-1.48z" />
    </svg>
  );
}

type Ranked = { spot: Spot; km: number; roadKm: number };

function NearItem({ spot, roadKm }: Ranked) {
  return (
    <li className="near-item">
      <Link
        to="/"
        search={{ spot: spot.google_place_id }}
        className="near-cover"
        style={{ backgroundImage: coverImage(spot) }}
        aria-label={`Open ${spot.name}`}
      />
      <div className="near-main">
        <span className="near-name">{spot.name}</span>
        <span className="near-meta">
          {spot.neighborhood ?? "Addis Ababa"}
          {spot.price_level != null ? ` · ${PRICE_LABELS[spot.price_level]}` : ""}
        </span>
      </div>
      {/* estimated road distance (~) — see estimateRoadKm; not real routing */}
      <span className="near-dist" title="Estimated travel distance">
        ~{formatRoadEstimate(roadKm)}
      </span>
      <span className="near-actions">
        <a
          className="action-btn"
          href={mapsUrl(spot)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Map of ${spot.name}`}
        >
          <PinIcon />
          <span className="abtn-label">Map</span>
        </a>
        {spot.source_video_url && (
          <a
            className="action-btn"
            href={spot.source_video_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Watch ${spot.name} on TikTok`}
            onClick={(e) => openTikTok(e, spot.source_video_url!)}
          >
            <TikTokIcon />
            <span className="abtn-label">Watch</span>
          </a>
        )}
      </span>
    </li>
  );
}

export function NearMe() {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [radius, setRadius] = useState(5);
  const geo = useGeolocation();

  // Ask for location and load the catalog as soon as the page opens.
  useEffect(() => {
    geo.request();
    fetchSpots()
      .then(setSpots)
      .catch(() => setLoadFailed(true));
    // request is stable; run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ranked = useMemo<Ranked[]>(() => {
    if (!spots || !geo.coords) return [];
    const here = geo.coords;
    return spots
      .map((s) => {
        const km = haversineKm(here, { lat: s.lat, lng: s.lng });
        return { spot: s, km, roadKm: estimateRoadKm(km) };
      })
      .sort((a, b) => a.km - b.km);
  }, [spots, geo.coords]);

  // radius is in travel terms now, so filter on the road estimate
  const within = useMemo(
    () => ranked.filter((r) => r.roadKm <= radius),
    [ranked, radius],
  );

  const header = (
    <header className="near-top">
      <Link to="/" className="near-back">
        <BackIcon /> All spots
      </Link>
      <div className="near-title">
        <BrandMark className="brand-mark" />
        <div>
          <h1>Near you</h1>
          <p>Spots closest to where you are right now</p>
        </div>
      </div>
    </header>
  );

  // ---- body by state ----
  let body: ReactNode;
  if (geo.status === "denied") {
    body = (
      <div className="near-state">
        <h2>Location is off</h2>
        <p>Allow location access in your browser, then try again to see what's nearby.</p>
        <button className="appstate-btn" onClick={geo.request}>
          Try again
        </button>
      </div>
    );
  } else if (geo.status === "unavailable") {
    body = (
      <div className="near-state">
        <h2>Can't find your location</h2>
        <p>Your device couldn't share a location right now. You can still browse all spots.</p>
        <Link to="/" className="appstate-btn">
          Browse all spots
        </Link>
      </div>
    );
  } else if (loadFailed) {
    body = (
      <div className="near-state">
        <h2>Couldn't load spots</h2>
        <p>We couldn't reach the server. Check your connection and try again.</p>
      </div>
    );
  } else if (geo.status === "idle" || geo.status === "locating" || !spots) {
    body = (
      <div className="near-state" aria-busy="true">
        <span className="near-spinner" aria-hidden="true" />
        <p>Finding spots near you…</p>
      </div>
    );
  } else if (geo.coarse) {
    // The fix is too rough (IP/Wi-Fi fallback, common on desktops) to rank by
    // distance honestly — don't show fabricated metres off a multi-km error.
    const accLabel = geo.accuracy ? formatDistance(geo.accuracy / 1000) : "a few km";
    body = (
      <div className="near-state">
        <h2>Location too approximate</h2>
        <p>
          Your device could only place you within about {accLabel}, which is too
          rough to rank spots by distance. Open this on your phone for GPS, or
          try again.
        </p>
        <button className="appstate-btn" onClick={geo.request}>
          Try again
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <div className="near-controls" role="group" aria-label="Distance">
          {RADII.map((r) => (
            <button
              key={r.label}
              className={"near-radius" + (radius === r.value ? " on" : "")}
              onClick={() => setRadius(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {geo.farFromAddis && (
          <p className="geo-note" role="status">
            You appear to be outside Addis — these are the spots closest to your current location.
          </p>
        )}
        {within.length ? (
          <ul className="near-list">
            {within.map((r) => (
              <NearItem key={r.spot.google_place_id} {...r} />
            ))}
          </ul>
        ) : (
          <div className="near-state">
            <p>
              No spots within {RADII.find((r) => r.value === radius)?.label.toLowerCase()} of you.
              {radius < MAX_RADIUS ? " Try a wider distance." : ""}
            </p>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="app near-page">
      {header}
      {body}
    </div>
  );
}
