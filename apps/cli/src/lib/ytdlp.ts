/**
 * yt-dlp wrappers. Two calls:
 *  - enumerateChannel: cheap flat listing of a channel's videos (one request).
 *  - fetchVideo: full metadata for a single video (caption, counts, timestamp…).
 *
 * The binary is resolved from YT_DLP_BIN (default "yt-dlp"). TikTok's extractor
 * changes often — if calls start failing, update yt-dlp.
 */
import { getEnv } from "../env.ts";
import { run } from "./exec.ts";
import { sleep } from "./throttle.ts";

/** The subset of yt-dlp's TikTok metadata we consume. */
export type RawVideo = {
  id: string;
  webpage_url?: string;
  url?: string;
  title?: string;
  description?: string;
  tags?: string[];
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  repost_count?: number; // TikTok "shares"
  timestamp?: number; // epoch seconds
  thumbnail?: string;
};

type FlatEntry = { id?: string; url?: string; webpage_url?: string };

const bin = () => getEnv().YT_DLP_BIN;

/**
 * Retry a yt-dlp call on failure. TikTok's extractor is intermittently flaky
 * (transient rejects, "unable to extract universal data for rehydration"); the
 * same request usually succeeds on a later attempt. Backoff grows per attempt.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  baseDelayMs = 1500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(baseDelayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

export type ListedVideo = { id: string; url: string };

/** Flat-list a channel's videos (ids + urls), newest first. Retries once so one
 * transient reject doesn't drop a whole channel. */
export async function enumerateChannel(
  url: string,
  retries = 1,
): Promise<ListedVideo[]> {
  return withRetry(async () => {
    const { stdout } = await run([
      bin(),
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      url,
    ]);
    const data = JSON.parse(stdout) as { entries?: FlatEntry[] };
    return (data.entries ?? [])
      .filter((e): e is FlatEntry & { id: string } => Boolean(e.id))
      .map((e) => ({
        id: e.id,
        url: e.webpage_url ?? e.url ?? `https://www.tiktok.com/video/${e.id}`,
      }));
  }, retries);
}

/** Full metadata for one video. Retries up to twice on transient TikTok errors. */
export async function fetchVideo(url: string, retries = 2): Promise<RawVideo> {
  return withRetry(async () => {
    const { stdout } = await run([
      bin(),
      "--skip-download",
      "--dump-json",
      "--no-warnings",
      url,
    ]);
    return JSON.parse(stdout) as RawVideo;
  }, retries);
}
