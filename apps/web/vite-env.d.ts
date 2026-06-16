/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  // Optional: Google Maps Embed API key (free, unlimited). Unset → Leaflet fallback.
  readonly VITE_GOOGLE_MAPS_EMBED_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
