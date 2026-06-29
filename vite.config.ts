import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` is set so the built site works when served from a GitHub Pages
// project subpath (https://<user>.github.io/osm-terrain-studio/).
// Override with VITE_BASE when deploying elsewhere (e.g. a custom domain → "/").
export default defineConfig({
  base: process.env.VITE_BASE ?? "/osm-terrain-studio/",
  plugins: [react()],
});
