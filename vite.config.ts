import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` defaults to a relative path ("./") so the built site works no matter
// what subpath it's served from — GitHub Pages project site, a renamed repo,
// a custom domain, or a local `file://` open. The app uses URL *hash* state
// only (no path-based routing), so a relative base is always safe.
// Override with VITE_BASE if you need an absolute base for some other host.
export default defineConfig({
  base: process.env.VITE_BASE ?? "./",
  plugins: [react()],
});
