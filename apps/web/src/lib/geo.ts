import { useCallback, useState } from "react";

/** A latitude/longitude pair. Spots already carry `lat`/`lng` as numbers. */
export type Coords = { lat: number; lng: number };

/** Greater Addis Ababa centre + a generous radius. Used only to tell when a
 * fix is far enough away that "nearby" distances stop being meaningful. */
const ADDIS: Coords = { lat: 9.0108, lng: 38.7613 };
const ADDIS_RADIUS_KM = 60;

/** Above this reported accuracy radius (metres) a fix can't give trustworthy
 * distances — it's almost certainly an IP/Wi-Fi fallback, not GPS. Desktops
 * with no GPS routinely report several km here. */
const COARSE_ACCURACY_M = 1000;

const EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle (Haversine) distance between two points, in kilometres. */
export function haversineKm(a: Coords, b: Coords): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** Human-friendly distance: metres under 1 km, one decimal under 10, else round. */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * Estimate road distance from straight-line distance with a flat factor.
 *
 * Calibrated against Google driving distances from a real Addis origin (6 spots:
 * mean Google/straight = 1.74×, CV 11% — consistent, with no distance trend, so
 * a constant fits better than a power curve). A 2,086-pair OSRM sweep agreed the
 * exponent is ~0.94 (i.e. flat). Still an estimate, not routing: circuity does
 * vary by origin (well-connected ~1.4×, constrained/peripheral ~1.75×), so this
 * leans slightly conservative. Retune ROAD_FACTOR with more origins if needed.
 */
const ROAD_FACTOR = 1.7;
export function estimateRoadKm(straightKm: number): number {
  return Math.max(0, straightKm) * ROAD_FACTOR;
}

export function isNearAddis(c: Coords): boolean {
  return haversineKm(c, ADDIS) <= ADDIS_RADIUS_KM;
}

export type GeoStatus =
  | "idle"
  | "locating"
  | "granted"
  | "denied"
  | "unavailable";

export type GeoState = {
  coords: Coords | null;
  /** Reported accuracy radius of the fix, in metres (95% confidence). */
  accuracy: number | null;
  /** Fix is too imprecise for trustworthy distances (IP/Wi-Fi fallback). */
  coarse: boolean;
  status: GeoStatus;
  /** We have a fix, but it's well outside Addis (distances won't be useful). */
  farFromAddis: boolean;
  request: () => void;
};

/**
 * One-shot browser geolocation. The coordinates stay on the device — they are
 * never written to Supabase or logged — so this adds proximity features without
 * touching the backend or any billable API.
 */
export function useGeolocation(): GeoState {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setAccuracy(pos.coords.accuracy);
        setStatus("granted");
      },
      (err) => {
        setAccuracy(null);
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  const farFromAddis = coords != null && !isNearAddis(coords);
  const coarse = accuracy != null && accuracy > COARSE_ACCURACY_M;
  return { coords, accuracy, coarse, status, farFromAddis, request };
}
