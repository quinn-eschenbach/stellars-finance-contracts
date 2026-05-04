import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { getDb } from "@stellars/db";
import { loadConfig } from "./config.js";
import { Broadcaster } from "./broadcaster.js";
import { buildRestRoutes } from "./rest.js";
import { buildSseRoutes } from "./sse.js";

async function main() {
  const config = loadConfig();
  const db = getDb();
  const broadcaster = new Broadcaster(config.databaseUrl);

  await broadcaster.connect();

  const app = new Hono();
  app.use("*", cors({ origin: config.corsOrigins }));

  // All API routes live under /api so the same server can serve the SPA at
  // /. In dev the vite proxy passes `/api/*` straight through; the dev path
  // and prod path now share semantics.
  app.get("/api/healthz", (c) => c.json({ ok: true }));
  app.route("/api", buildRestRoutes(db));
  app.route("/api/stream", buildSseRoutes(db, broadcaster));

  // Static frontend — only when STATIC_ROOT points at a real directory
  // (production image bakes the dist there). In dev the file doesn't exist
  // and we let vite handle the SPA.
  const staticRoot = process.env.STATIC_ROOT
    ? resolve(process.env.STATIC_ROOT)
    : null;
  if (staticRoot && existsSync(staticRoot)) {
    console.log(`[api] serving static frontend from ${staticRoot}`);
    app.use("/*", serveStatic({ root: staticRoot }));
    // SPA fallback: any unmatched GET returns index.html so client-side
    // routing works on hard reloads / direct URLs.
    app.get("*", serveStatic({ path: `${staticRoot}/index.html` }));
  }

  console.log(`[api] listening on :${config.port}`);
  console.log(`[api] cors origins: ${config.corsOrigins.join(", ")}`);

  const shutdown = async () => {
    console.log("[api] shutting down…");
    await broadcaster.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // idleTimeout: 0 disables Bun's default 10s per-connection idle timeout.
  // SSE streams sit quiet between events (vault/positions can be silent for
  // minutes) and the 10s default kills them mid-stream, which the vite proxy
  // surfaces as "socket hang up" and the browser as repeated EventSource
  // reconnects. SSE clients close the socket themselves when they leave the
  // page, so no timeout is the correct behavior for this server.
  return { port: config.port, fetch: app.fetch, idleTimeout: 0 };
}

// Bun auto-detects default exports with `port` + `fetch` and serves them.
export default await main().catch((err) => {
  console.error("[api] fatal:", err);
  process.exit(1);
});
