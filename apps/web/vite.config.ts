import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  // Load env from the repo root so the shared .env (VITE_-prefixed vars only)
  // is picked up. The secret key is never VITE_-prefixed, so it isn't exposed.
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
});
