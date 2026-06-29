/**
 * Pull coordinates out of a pasted Google Maps URL — entirely client-side, no
 * Places API call (so it never costs anything). We read the place pin
 * (`!3d<lat>!4d<lng>`) when present, else the viewport center (`/@lat,lng`), else
 * a `q=`/`ll=` query coordinate. Short links (maps.app.goo.gl) redirect and
 * carry no coordinates, so those can't be resolved here — the caller asks the
 * user to paste the full URL instead.
 */
export type LatLng = { lat: number; lng: number };

const inRange = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180;

const PATTERNS: RegExp[] = [
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, // exact place pin — most accurate
  /@(-?\d+\.\d+),(-?\d+\.\d+)/, // /@lat,lng viewport center
  /[?&](?:q|query|ll|sll|center)=(-?\d+\.\d+),(-?\d+\.\d+)/, // q=lat,lng
];

export function parseMapsUrl(input: string): LatLng | null {
  const s = input.trim();
  if (!s) return null;
  for (const re of PATTERNS) {
    const m = s.match(re);
    if (m) {
      const lat = parseFloat(m[1]!);
      const lng = parseFloat(m[2]!);
      if (inRange(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

/** A shortened Maps link we can't resolve in the browser (it redirects). */
export function isShortMapsLink(input: string): boolean {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(input.trim());
}
