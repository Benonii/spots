import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Service worker silently updates in the background and activates on the
      // next load — no "new version" prompt to build/maintain.
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.ico", "favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Spots — date ideas around Addis Ababa",
        short_name: "Spots",
        description:
          "Curated date spots around Addis Ababa, from the people who actually went.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#fbf9f4",
        background_color: "#fbf9f4",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell so it boots instantly / offline. Client-side
        // routes fall back to index.html when offline.
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            // Public spots catalog (PostgREST GET). NetworkFirst: fresh when
            // online, last-loaded list when offline. Per-user/auth endpoints
            // (visits, saved, profiles) are intentionally NOT cached.
            //
            // End-anchored on `select=*` so it matches the catalog query alone.
            // The single-row fetch in index.html carries a random `&offset=`
            // that never repeats, and would otherwise fill this 8-entry cache
            // with dead URLs and evict the catalog that offline mode needs.
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/rest\/v1\/spots\?select=\*$/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "spots-data",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Re-hosted spot covers in Supabase Storage — rarely change.
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "spot-covers",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Carto basemap tiles for the Leaflet map.
            urlPattern: /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // (Google Fonts caching rules removed — Quicksand is self-hosted now
          // and covered by the woff2 precache glob above.)
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Vendor libs change only on dependency bumps: keeping them in their
        // own chunks lets returning visitors (and the PWA precache) reuse them
        // across app deploys instead of re-downloading one monolithic bundle.
        advancedChunks: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "router", test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: "supabase", test: /node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
  // Load env from the repo root so the shared .env (VITE_-prefixed vars only)
  // is picked up. The secret key is never VITE_-prefixed, so it isn't exposed.
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
});
