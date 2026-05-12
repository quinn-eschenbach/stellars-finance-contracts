import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import { resolve } from "node:path";

export default defineConfig(({ command }) => {
  const e2e = process.env.VITE_E2E === "1";

  // Refuse to ship the E2E stub into a real build. The alias only activates
  // for `vite serve` (dev mode), but we want a `VITE_E2E=1 pnpm build`
  // misconfiguration to fail loudly instead of silently producing a
  // production bundle that *looks* like an E2E build to the operator.
  if (e2e && command === "build") {
    throw new Error(
      "VITE_E2E=1 set during `vite build`. The E2E wallet stub is dev-only. " +
        "Unset VITE_E2E before building for production or preview.",
    );
  }

  return {
    plugins: [
      TanStackRouterVite({ routesDirectory: "src/routes", generatedRouteTree: "src/routeTree.gen.ts" }),
      react(),
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        // E2E swaps our wallet wrapper for a stub backed by `window.__walletStub`.
        // We alias at the domain boundary (`@/wallet/freighter`) rather than the
        // third-party module — the stub then only has to implement the four
        // exports our app actually uses, and the seam mirrors the same one
        // unit tests target structurally. Gated on `command === "serve"` so
        // even an accidental `VITE_E2E=1 vite build` (rejected above) can't
        // reach a code path where the stub gets bundled.
        ...(e2e && command === "serve"
          ? { "@/wallet/freighter": resolve(__dirname, "e2e/fixtures/freighter-stub.ts") }
          : {}),
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
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test-setup.ts"],
      css: false,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      exclude: ["node_modules", "dist", "e2e/**", "**/routeTree.gen.ts"],
    },
  };
});
