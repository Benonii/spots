// Open TikTok links in the native app on mobile, with a graceful web fallback.
// Desktop keeps the normal new-tab behaviour (this returns without touching the event).

const ANDROID = /Android/i;
const IOS = /iPhone|iPad|iPod/i;
const TIKTOK_ANDROID_PKG = "com.zhiliaoapp.musically";

export function openTikTok(e: React.MouseEvent, webUrl: string): void {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const android = ANDROID.test(ua);
  const ios = IOS.test(ua);
  if (!android && !ios) return; // desktop: let the <a target="_blank"> handle it

  if (android) {
    // Android intent URL: opens the TikTok app if installed, else the web URL.
    e.preventDefault();
    const path = webUrl.replace(/^https?:\/\//, "");
    window.location.href =
      `intent://${path}#Intent;scheme=https;package=${TIKTOK_ANDROID_PKG};` +
      `S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
    return;
  }

  // iOS: a top-level navigation lets the Universal Link open the app if it's
  // installed; otherwise it just loads the TikTok page. (target="_blank" would
  // keep it trapped in the in-app browser, so we navigate the page itself.)
  e.preventDefault();
  window.location.href = webUrl;
}
