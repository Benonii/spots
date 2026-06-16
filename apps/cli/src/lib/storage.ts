/**
 * Supabase Storage helpers — re-host cover thumbnails so they stop expiring.
 *
 * TikTok thumbnail URLs are signed and die after ~6 days, so we copy each one
 * into a public Storage bucket and serve that permanent URL instead. Uses the
 * Storage REST API with the secret (service-role) key (no supabase-js dep);
 * CLI-only, so the secret never reaches the browser.
 */
import { getEnv } from "../env.ts";

export const COVERS_BUCKET = "spot-covers";

/** True if the Supabase Storage credentials are configured. */
export function storageConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

const base = () => getEnv().SUPABASE_URL!.replace(/\/+$/, "");
const secret = () => getEnv().SUPABASE_SECRET_KEY!;

// New-style `sb_secret_*` keys aren't JWTs, so the Storage gateway needs them in
// the `apikey` header too — `Authorization: Bearer` alone returns "Invalid
// Compact JWS". Sending both mirrors what supabase-js does.
const authHeaders = (): Record<string, string> => ({
  apikey: secret(),
  Authorization: `Bearer ${secret()}`,
});

/** Public URL for an object already in the covers bucket. */
export function coverPublicUrl(path: string): string {
  return `${base()}/storage/v1/object/public/${COVERS_BUCKET}/${path}`;
}

/** True if a stored cover URL already points at our Storage bucket. */
export function isRehosted(url: string | null): boolean {
  if (!url || !getEnv().SUPABASE_URL) return false;
  return url.startsWith(coverPublicUrl(""));
}

/** Create the public covers bucket if it doesn't already exist (idempotent). */
export async function ensureCoversBucket(): Promise<void> {
  const res = await fetch(`${base()}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id: COVERS_BUCKET, name: COVERS_BUCKET, public: true }),
  });
  if (res.ok) return;
  const body = await res.text();
  // Already-exists comes back as 400 ("already exists") or 409 — both fine.
  if (res.status === 409 || /exist/i.test(body)) return;
  throw new Error(`createBucket ${res.status}: ${body.slice(0, 200)}`);
}

/**
 * Download `srcUrl` and upload it to `<placeId>.jpg` in the covers bucket,
 * returning the permanent public URL. Returns null if the source can't be
 * fetched (e.g. an already-expired thumbnail) — callers keep the old value.
 * Throws only on an actual Storage upload failure (misconfig worth surfacing).
 */
export async function rehostCover(
  placeId: string,
  srcUrl: string | null,
): Promise<string | null> {
  if (!srcUrl) return null;

  let bytes: ArrayBuffer;
  let contentType: string;
  try {
    const img = await fetch(srcUrl);
    if (!img.ok) return null; // expired / forbidden source
    contentType = img.headers.get("content-type") ?? "image/jpeg";
    bytes = await img.arrayBuffer();
    if (bytes.byteLength === 0) return null;
  } catch {
    return null; // network error fetching the source — non-fatal
  }

  // Stable path so re-runs overwrite in place. Extension is cosmetic (Storage
  // serves the stored content-type), kept as .jpg for simplicity.
  const path = `${placeId}.jpg`;
  const up = await fetch(`${base()}/storage/v1/object/${COVERS_BUCKET}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": contentType, "x-upsert": "true" },
    body: bytes,
  });
  if (!up.ok) {
    throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
  }
  return coverPublicUrl(path);
}
