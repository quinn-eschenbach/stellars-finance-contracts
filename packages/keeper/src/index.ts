import "dotenv/config";
import { getDb } from "@stellars/db";
import { loadConfig } from "./config.js";
import { createExecutor } from "./executor.js";
import { TtlDedup } from "./dedup.js";
import { createSerializer } from "./serializer.js";
import { runHotLoop, runColdLoop } from "./loop.js";

async function main() {
  const config = loadConfig();
  const db = getDb();
  const executor = createExecutor(config);
  const dedup = new TtlDedup();
  const serialize = createSerializer();

  console.log(`[keeper] Network:        ${config.network}`);
  console.log(`[keeper] Address:        ${executor.publicKey}`);
  console.log(`[keeper] PM contract:    ${config.contracts.positionManager.address}`);
  console.log(`[keeper] Cold cadence:   ${config.pollIntervalMs}ms`);
  console.log(`[keeper] Hot idle:       ${config.liquidationIdleMs}ms`);
  console.log(`[keeper] Index threshold: ${config.indexUpdateThresholdSec}s`);
  console.log(`[keeper] Safety margin:  ${config.liquidationSafetyMarginBps}bps`);
  console.log(`[keeper] Stale alert:    ${config.staleAlertSec}s`);
  console.log(`[keeper] Stale skip:     ${config.staleHardSkipSec}s`);

  let running = true;
  const isRunning = () => running;
  const shutdown = () => {
    if (!running) return;
    console.log("[keeper] Shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Hot loop chases liquidations as fast as the chain will allow.
  // Cold loop runs indices / TP-SL / ADL on a fixed 5s cadence.
  // Both submit through one shared serializer that holds the keeper account
  // sequence-number under a single in-flight submission.
  await Promise.all([
    runHotLoop(db, executor, config, dedup, serialize, isRunning),
    runColdLoop(db, executor, config, dedup, serialize, isRunning),
  ]);

  console.log("[keeper] Stopped.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[keeper] Fatal:", err);
  process.exit(1);
});
