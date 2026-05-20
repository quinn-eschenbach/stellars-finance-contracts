import type { Db } from "@stellars/db";
import { BPS, toBigInt } from "@stellars/protocol-math";
import type { Executor } from "./executor.js";
import type { KeeperConfig } from "./config.js";
import type { TtlDedup } from "./dedup.js";
import type { Serialize } from "./serializer.js";
import {
  findAdlTarget,
  loadKeeperWorld,
  scanLiquidationCandidates,
  type KeeperWorld,
} from "./scanner.js";

import {
  KEEPER_INDEX_UPDATE_DEDUP_TTL_MS,
  KEEPER_LIQUIDATION_DEDUP_TTL_MS,
} from "@stellars/config";

export const DEDUP_TTL_MS = KEEPER_LIQUIDATION_DEDUP_TTL_MS;
const INDICES_DEDUP_TTL_MS = KEEPER_INDEX_UPDATE_DEDUP_TTL_MS;

export function posKey(trader: string, symbol: string): string {
  return `${trader}:${symbol}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Three-state staleness gate. `skip:true` means the loop must not act this
 * tick. Operators are warned at the soft threshold but the tick still runs.
 */
function checkStaleness(
  world: KeeperWorld,
  config: KeeperConfig,
  loopName: string,
): { skip: boolean; lagSec: number } {
  const lagSec = world.indexerLagSec;
  if (lagSec > config.staleHardSkipSec) {
    console.warn(`[${loopName}] indexer lag=${lagSec}s exceeds hard skip threshold; skipping`);
    return { skip: true, lagSec };
  }
  if (lagSec > config.staleAlertSec) {
    console.warn(`[${loopName}] indexer lag=${lagSec}s — degraded`);
  }
  return { skip: false, lagSec };
}

// -- Hot loop: liquidations only --------------------------------------------

export async function runHotLoop(
  db: Db,
  executor: Executor,
  config: KeeperConfig,
  dedup: TtlDedup,
  serialize: Serialize,
  isRunning: () => boolean,
): Promise<void> {
  while (isRunning()) {
    let workDone = false;

    try {
      const world = await loadKeeperWorld(db);
      const { skip } = checkStaleness(world, config, "hot");
      if (skip) {
        await sleep(config.liquidationIdleMs);
        continue;
      }

      const candidates = scanLiquidationCandidates(world, config);
      if (candidates.length === 0) {
        await sleep(config.liquidationIdleMs);
        continue;
      }

      for (const { pos } of candidates) {
        if (!isRunning()) break;
        const key = posKey(pos.trader, pos.symbol);
        if (!dedup.claim(key, DEDUP_TTL_MS)) continue;

        const outcome = await serialize(() =>
          executor.liquidatePosition(pos.trader, pos.symbol),
        );
        if (outcome.kind !== "submitted") {
          dedup.release(key);
        } else {
          workDone = true;
        }
      }
    } catch (err) {
      console.error("[hot] tick error:", err);
    }

    if (!workDone && isRunning()) {
      await sleep(config.liquidationIdleMs);
    }
  }
}

// -- Cold loop: indices, TP/SL, ADL ------------------------------------------

async function runColdTick(
  db: Db,
  executor: Executor,
  config: KeeperConfig,
  dedup: TtlDedup,
  serialize: Serialize,
): Promise<void> {
  const world = await loadKeeperWorld(db);
  const { skip } = checkStaleness(world, config, "cold");
  if (skip) return;

  // Step 1: Update stale indices. Per-symbol dedup avoids re-submitting the
  // same updateIndices when the indexer is lagging — without it, two
  // consecutive cold-loop ticks both observe the same stale last_index_update
  // and double-fire.
  //
  // Skip markets with zero open interest. A market with no positions has no
  // fees to accumulate, so `update_indices` is a no-op on-chain; firing it
  // anyway burns gas indefinitely on fresh markets where `last_index_update`
  // never gets persisted (the contract's `get_market` default reads back
  // `last_index_update = now`, so the `time_delta > 0` branch never runs and
  // the indexer never sees an `UpdateIndices` event to mirror).
  for (const market of world.markets) {
    if (world.vault?.is_paused) break;
    const totalOi = toBigInt(market.long_open_interest) + toBigInt(market.short_open_interest);
    if (totalOi === 0n) continue;
    const lastUpdate = toBigInt(market.last_index_update);
    const elapsed = world.now - lastUpdate;
    if (elapsed > BigInt(config.indexUpdateThresholdSec)) {
      const key = `indices:${market.symbol}`;
      if (!dedup.claim(key, INDICES_DEDUP_TTL_MS)) continue;
      const outcome = await serialize(() => executor.updateIndices(market.symbol));
      if (outcome.kind === "rejected" && !outcome.expected) {
        // Release the dedup slot on unexpected failure so the next tick can
        // try again immediately; expected rejections (e.g. paused) hold the
        // slot for the full TTL.
        dedup.release(key);
      }
    }
  }

  // Step 2: TP/SL order execution.
  const minLifetime = toBigInt(world.protocolConfig?.min_position_lifetime);
  for (const pos of world.positions) {
    const tp = toBigInt(pos.take_profit);
    const sl = toBigInt(pos.stop_loss);
    if (tp === 0n && sl === 0n) continue;

    const tick = world.ticks.get(pos.symbol);
    if (!tick) continue;

    const age = world.now - toBigInt(pos.last_increased_time);
    if (age < minLifetime) continue;

    const triggered =
      tick.isTpTriggered(tp, pos.is_long) || tick.isSlTriggered(sl, pos.is_long);
    if (!triggered) continue;

    const key = posKey(pos.trader, pos.symbol);
    if (!dedup.claim(key, DEDUP_TTL_MS)) continue;
    const outcome = await serialize(() => executor.executeOrder(pos.trader, pos.symbol));
    if (outcome.kind !== "submitted") dedup.release(key);
  }

  // Step 3: ADL check.
  if (world.vault && world.protocolConfig) {
    const totalAssets = toBigInt(world.vault.total_assets);
    if (totalAssets > 0n) {
      const netPnl = toBigInt(world.vault.net_global_trader_pnl);
      const reserved = toBigInt(world.vault.reserved_usdc);
      const adlPnlBps = BigInt(world.protocolConfig.adl_pnl_bps);
      const adlUtilBps = BigInt(world.protocolConfig.adl_utilization_bps);

      const pnlTrigger = netPnl > 0n && (netPnl * BPS) / totalAssets > adlPnlBps;
      const utilTrigger = (reserved * BPS) / totalAssets > adlUtilBps;

      if (pnlTrigger || utilTrigger) {
        const target = findAdlTarget(world);
        if (target) {
          const key = posKey(target.trader, target.symbol);
          if (dedup.claim(key, DEDUP_TTL_MS)) {
            const outcome = await serialize(() =>
              executor.deleveragePosition(target.trader, target.symbol),
            );
            if (outcome.kind !== "submitted") dedup.release(key);
          }
        }
      }
    }
  }
}

export async function runColdLoop(
  db: Db,
  executor: Executor,
  config: KeeperConfig,
  dedup: TtlDedup,
  serialize: Serialize,
  isRunning: () => boolean,
): Promise<void> {
  while (isRunning()) {
    const tickStart = Date.now();
    try {
      await runColdTick(db, executor, config, dedup, serialize);
    } catch (err) {
      console.error("[cold] tick error:", err);
    }

    // Fixed cadence: sleep the remainder of pollIntervalMs. If the tick
    // ran longer than the cadence, the next tick starts immediately
    // (skip-if-busy is implicit because we don't queue overlapping ticks).
    const remaining = config.pollIntervalMs - (Date.now() - tickStart);
    if (remaining > 0 && isRunning()) await sleep(remaining);
  }
}

