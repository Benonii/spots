/**
 * ScrapFly wrapper for TikTok comments.
 *
 * TikTok's comment API (/api/comment/list/) is anti-bot protected, so we route
 * it through ScrapFly with ASP (Anti Scraping Protection) enabled — ScrapFly
 * supplies the browser context/signing TikTok requires. The endpoint returns
 * JSON; we keep the top comments by like count.
 *
 * Note: ASP requests cost more ScrapFly credits than a plain fetch. Scope runs
 * with --limit / --min-views (the comments command does this).
 */
import { ScrapflyClient, ScrapeConfig, ScrapeResult } from "scrapfly-sdk";
import type { TopComment } from "@date-finder/db";
import { getEnv } from "../env.ts";

let client: ScrapflyClient | null = null;

function getClient(): ScrapflyClient {
  client ??= new ScrapflyClient({ key: getEnv().SCRAPFLY_KEY! });
  return client;
}

type RawComment = {
  text?: string;
  digg_count?: number; // likes
  user?: { nickname?: string; unique_id?: string };
};

/** Fetch up to `count` top comments (by likes) for a TikTok video id. */
export async function fetchTopComments(
  videoId: string,
  count = 20,
): Promise<TopComment[]> {
  const url =
    `https://www.tiktok.com/api/comment/list/?aweme_id=${videoId}` +
    `&count=${count}&cursor=0&aid=1988`;

  const scraped = await getClient().scrape(
    new ScrapeConfig({ url, asp: true, country: "us", render_js: false }),
  );
  // scrape() can return a Response for async/webhook configs; ours is sync.
  if (!(scraped instanceof ScrapeResult)) {
    throw new Error("Unexpected non-ScrapeResult response from ScrapFly");
  }

  const { content, status_code } = scraped.result;
  let data: { comments?: RawComment[] };
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error(`Non-JSON comment response (upstream status ${status_code})`);
  }

  const comments = Array.isArray(data.comments) ? data.comments : [];
  return comments
    .map((c) => ({
      text: c.text ?? "",
      likes: c.digg_count ?? 0,
      author: c.user?.nickname ?? c.user?.unique_id ?? "",
    }))
    .filter((c) => c.text.length > 0)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, count);
}
