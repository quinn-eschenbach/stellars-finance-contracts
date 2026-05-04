import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ routesDirectory: "src/routes", generatedRouteTree: "src/routeTree.gen.ts" }),
    react(),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // No path rewrite: api routes are mounted under /api server-side too,
      // so dev and prod share the same URL shape (browser hits /api/markets,
      // backend handles /api/markets).
      "/api": {
        target: process.env.VITE_API_URL ?? "http://localhost:3030",
        changeOrigin: true,
      },
    },
  },
});
