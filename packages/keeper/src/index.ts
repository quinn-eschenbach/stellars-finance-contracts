import "dotenv/config";
import { getDb } from "@stellars/db";
import { loadConfig } from "./config.js";
import { createExecutor } from "./executor.js";
import { runTick } from "./loop.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = loadConfig();
  const db = getDb();
  const executor = createExecutor(config);

  console.log(`[keeper] Network: ${config.network}`);
  console.log(`[keeper] Address: ${executor.publicKey}`);
  console.log(`[keeper] PM contract: ${config.contracts.positionManager.address}`);
  console.log(`[keeper] Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`[keeper] Index update threshold: ${config.indexUpdateThresholdSec}s`);

  let running = true;
  const shutdown = () => {
    console.log("[keeper] Shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    try {
      await runTick(db, executor, config);
    } catch (err) {
      console.error("[keeper] Tick error:", err);
    }
    await sleep(config.pollIntervalMs);
  }

  console.log("[keeper] Stopped.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[keeper] Fatal:", err);
  process.exit(1);
});
