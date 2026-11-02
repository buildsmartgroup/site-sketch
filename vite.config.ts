import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages project site: https://buildsmartgroup.github.io/site-sketch/
const BASE = "/site-sketch/";

export default defineConfig({
  base: BASE,
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"],
      manifest: {
        name: "Site Sketch",
        short_name: "Site Sketch",
        description: "Buildsmart Group site sketching for iPad. Plans are stored in millimetres.",
        id: BASE,
        start_url: BASE,
        scope: BASE,
        display: "standalone",
        orientation: "any",
        background_color: "#f3f0e8",
        theme_color: "#1e3554",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2}"],
        navigateFallback: `${BASE}index.html`,
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
