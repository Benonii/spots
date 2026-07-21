import { onCLS, onINP, onLCP, onTTFB, onFCP, type Metric } from "web-vitals";

/**
 * Real-user Core Web Vitals, reported into the existing `events` table as
 * `web_vital` events so they can be queried next to product analytics.
 *
 * CLS and INP only settle when the page is being hidden/unloaded — at that
 * point the browser cancels ordinary fetches (and supabase-js doesn't set
 * `keepalive`), so metrics are POSTed straight to PostgREST with
 * `keepalive: true`, which lets the request outlive the page.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const AID_KEY = "spots:aid";

function anonId(): string | null {
  try {
    return localStorage.getItem(AID_KEY) ?? sessionStorage.getItem(AID_KEY);
  } catch {
    return null;
  }
}

function report(metric: Metric): void {
  try {
    void fetch(`${url}/rest/v1/events`, {
      method: "POST",
      keepalive: true,
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        name: "web_vital",
        props: {
          metric: metric.name,
          value: Math.round(metric.value * 1000) / 1000,
          rating: metric.rating,
          navigation_type: metric.navigationType,
          metric_id: metric.id,
          effective_type:
            (navigator as { connection?: { effectiveType?: string } })
              .connection?.effectiveType ?? null,
        },
        anon_id: anonId(),
        path: window.location.pathname,
        user_agent: navigator.userAgent,
      }),
    }).catch(() => {});
  } catch {
    /* vitals reporting must never disrupt the app */
  }
}

export function initVitals(): void {
  onTTFB(report);
  onFCP(report);
  onLCP(report);
  onCLS(report);
  onINP(report);
}
