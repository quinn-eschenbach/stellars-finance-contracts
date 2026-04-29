import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
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
  await broadcaster.installTriggers();

  const app = new Hono();
  app.use("*", cors({ origin: config.corsOrigins }));

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/", buildRestRoutes(db));
  app.route("/stream", buildSseRoutes(db, broadcaster));

  console.log(`[api] listening on :${config.port}`);
  console.log(`[api] cors origins: ${config.corsOrigins.join(", ")}`);

  const shutdown = async () => {
    console.log("[api] shutting down…");
    await broadcaster.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { port: config.port, fetch: app.fetch };
}

// Bun auto-detects default exports with `port` + `fetch` and serves them.
export default await main().catch((err) => {
  console.error("[api] fatal:", err);
  process.exit(1);
});
