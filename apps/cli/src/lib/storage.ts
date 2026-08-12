/**
 * Supabase Storage helpers — re-host cover thumbnails so they stop expiring.
 *
 * TikTok thumbnail URLs are signed and die after ~6 days, so we copy each one
 * into a public Storage bucket and serve that permanent URL instead. Uses the
 * Storage REST API with the secret (service-role) key (no supabase-js dep);
 * CLI-only, so the secret never reaches the browser.
 */
import sharp from "sharp";
import { getEnv } from "../env.ts";

export const COVERS_BUCKET = "spot-covers";

/** Widths (px) of the responsive WebP variants uploaded next to each original.
 * The web app derives `<placeId>-<w>.webp` URLs from cover_image_url by this
 * naming convention — keep both sides in sync. */
export const COVER_VARIANT_WIDTHS = [480, 960] as const;

/**
 * Cache lifetime stored on every cover object. Storage defaults uploads to
 * `no-cache`, which makes browsers revalidate the image on every page view.
 * Covers sit at a stable path and only change when `covers --force` re-hosts
 * one, so a long-but-finite window beats `immutable`: a forced refresh becomes
 * visible within 30 days rather than never.
 */
export const COVER_CACHE_CONTROL = "max-age=2592000";

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
  await putCover(path, bytes, contentType);
  // Variants are best-effort: a decode failure must not lose the cover itself.
  try {
    await uploadCoverVariants(placeId, bytes);
  } catch {
    /* original still serves; `covers --variants` can retry later */
  }
  return coverPublicUrl(path);
}

/** Upload one cover object, upserting in place with our cache lifetime. */
export async function putCover(
  path: string,
  body: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const up = await fetch(`${base()}/storage/v1/object/${COVERS_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": contentType,
      "cache-control": COVER_CACHE_CONTROL,
      "x-upsert": "true",
    },
    body,
  });
  if (!up.ok) {
    throw new Error(`upload ${path} ${up.status}: ${(await up.text()).slice(0, 200)}`);
  }
}

/**
 * Resize + re-encode `bytes` into the responsive WebP variants and upload them
 * as `<placeId>-<w>.webp`. `withoutEnlargement` keeps small originals as-is
 * (upscaling would add bytes, not detail).
 */
export async function uploadCoverVariants(
  placeId: string,
  bytes: ArrayBuffer,
): Promise<void> {
  for (const w of COVER_VARIANT_WIDTHS) {
    const webp = await sharp(Buffer.from(bytes))
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    await putCover(`${placeId}-${w}.webp`, new Uint8Array(webp), "image/webp");
  }
}

/**
 * True if every responsive variant for `placeId` already exists in Storage.
 *
 * Existence only — deliberately not a cache-header check. Storage's metadata
 * reads (`/object/info`, and response headers on a fresh GET) lag a write by a
 * few seconds, so a header comparison here reports stale values and makes runs
 * non-deterministic. Changing COVER_CACHE_CONTROL therefore needs a one-off
 * forced re-upload; the existing objects were migrated on 2026-08-11.
 */
export async function coverVariantsExist(placeId: string): Promise<boolean> {
  for (const w of COVER_VARIANT_WIDTHS) {
    const res = await fetch(coverPublicUrl(`${placeId}-${w}.webp`), { method: "HEAD" });
    if (!res.ok) return false;
  }
  return true;
}
