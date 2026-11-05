import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: "AAJ Contact Scan",
        short_name: "AAJ Scan",
        description: "Scan business cards into a reviewed, HubSpot-ready CSV.",
        theme_color: "#ffffff",
        background_color: "#eef0f2",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/favicon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/favicon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          // Full-bleed icon: Android masks it and uses it on the launch screen.
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,webp,woff2}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
});
