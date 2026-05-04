import type { Db } from "@stellars/db";
import {
  MarketTick,
  BPS,
  type BorrowRateConfig,
  type MarketState,
  type PositionState,
  type VaultLiquidity,
} from "@stellars/protocol-math";
import type { Executor } from "./executor.js";
import type { KeeperConfig } from "./config.js";
import type { TtlDedup } from "./dedup.js";
import type { Serialize } from "./serializer.js";
import {
  getAllPositions,
  getMarkets,
  getLatestPrices,
  getVaultState,
  getProtocolConfig,
  getIndexerCursor,
  type PositionRow,
  type MarketRow,
  type VaultStateRow,
  type ProtocolConfigRow,
} from "./scanner.js";

export const DEDUP_TTL_MS = 60_000;

export function posKey(trader: string, symbol: string): string {
  return `${trader}:${symbol}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBigInt(value: string | null | undefined): bigint {
  if (value == null || value === "") return 0n;
  return BigInt(value);
}

/**
 * Indexer staleness check. Returns lag in seconds; Infinity if the cursor
 * row is missing or has never recorded a close time (cold-start).
 */
async function getIndexerLagSec(db: Db): Promise<number> {
  const cursor = await getIndexerCursor(db);
  if (!cursor) return Number.POSITIVE_INFINITY;
  const closeTime = Number(cursor.last_ledger_close_time);
  if (!closeTime) return Number.POSITIVE_INFINITY;
  return Math.floor(Date.now() / 1000) - closeTime;
}

/**
 * Three-state staleness gate. `skip:true` means the loop must not act this
 * tick. `alert:true` means lag exceeds the soft threshold; the loop should
 * still act but operators should know.
 */
async function checkStaleness(
  db: Db,
  config: KeeperConfig,
  loopName: string,
): Promise<{ skip: boolean; lagSec: number }> {
  const lagSec = await getIndexerLagSec(db);
  if (lagSec > config.staleHardSkipSec) {
    console.warn(`[${loopName}] indexer lag=${lagSec}s exceeds hard skip threshold; skipping`);
    return { skip: true, lagSec };
  }
  if (lagSec > config.staleAlertSec) {
    console.warn(`[${loopName}] indexer lag=${lagSec}s — degraded`);
  }
  return { skip: false, lagSec };
}

/** Adapt a markets row to the structural type protocol-math expects. */
function toMarketState(m: MarketRow): MarketState {
  return {
    acc_borrow_index: toBigInt(m.acc_borrow_index),
    acc_funding_index: toBigInt(m.acc_funding_index),
    last_index_update: toBigInt(m.last_index_update),
    long_open_interest: toBigInt(m.long_open_interest),
    short_open_interest: toBigInt(m.short_open_interest),
  };
}

function toVaultLiquidity(v: VaultStateRow | undefined): VaultLiquidity {
  return {
    reserved_usdc: toBigInt(v?.reserved_usdc),
    total_assets: toBigInt(v?.total_assets),
  };
}

function toBorrowRateConfig(c: ProtocolConfigRow | undefined): BorrowRateConfig {
  return {
    base_borrow_rate_bps: toBigInt(c?.base_borrow_rate_bps),
    slope1_bps: toBigInt(c?.slope1_bps),
    slope2_bps: toBigInt(c?.slope2_bps),
    optimal_utilization_bps: toBigInt(c?.optimal_utilization_bps),
    base_funding_rate_bps: toBigInt(c?.base_funding_rate_bps),
  };
}

function toPositionState(p: PositionRow): PositionState {
  return {
    is_long: p.is_long,
    size: toBigInt(p.size),
    collateral: toBigInt(p.collateral),
    entry_price: toBigInt(p.entry_price),
    entry_borrow_index: toBigInt(p.entry_borrow_index),
    entry_funding_index: toBigInt(p.entry_funding_index),
  };
}

/**
 * Build a Map<symbol, MarketTick> by projecting each market forward to `now`.
 * Symbols without a current price are skipped — callers handle missing ticks
 * the same way they handle missing positions.
 */
function buildTicks(
  allMarkets: MarketRow[],
  prices: Map<string, string>,
  vault: VaultLiquidity,
  rate_config: BorrowRateConfig,
  last_unpause_time: bigint,
  now: bigint,
): Map<string, MarketTick> {
  const ticks = new Map<string, MarketTick>();
  for (const m of allMarkets) {
    const priceStr = prices.get(m.symbol);
    if (!priceStr) continue;
    const tick = MarketTick.project({
      market: toMarketState(m),
      mark_price: toBigInt(priceStr),
      vault,
      rate_config,
      now,
      last_unpause_time,
    });
    ticks.set(m.symbol, tick);
  }
  return ticks;
}

// -- Liquidation candidate scanning ------------------------------------------

interface LiquidationCandidate {
  pos: PositionRow;
  health: bigint;
}

async function scanLiquidationCandidates(
  db: Db,
  config: KeeperConfig,
): Promise<LiquidationCandidate[]> {
  const nowUnix = BigInt(Math.floor(Date.now() / 1000));

  const [allPositions, allMarkets, prices, vault, protoCfg] = await Promise.all([
    getAllPositions(db),
    getMarkets(db),
    getLatestPrices(db),
    getVaultState(db),
    getProtocolConfig(db),
  ]);

  const ticks = buildTicks(
    allMarkets,
    prices,
    toVaultLiquidity(vault),
    toBorrowRateConfig(protoCfg),
    toBigInt(protoCfg?.last_unpause_time),
    nowUnix,
  );

  // Read the threshold from on-chain config (mirrored by the indexer into
  // protocol_config). Env var is a cold-start fallback before the indexer has
  // ingested the first LimitsUpdate event.
  const thresholdBps = BigInt(
    protoCfg?.liquidation_threshold_bps ?? config.liquidationSafetyMarginBps,
  );
  const candidates: LiquidationCandidate[] = [];
  for (const pos of allPositions) {
    const tick = ticks.get(pos.symbol);
    if (!tick) continue;

    const collateral = toBigInt(pos.collateral);
    const threshold = (collateral * thresholdBps) / BPS;
    const { health } = tick.evaluate(toPositionState(pos));
    if (health >= threshold) continue;

    candidates.push({ pos, health });
  }

  // Worst-health-first so we minimise cumulative bad debt during cascades.
  candidates.sort((a, b) => (a.health < b.health ? -1 : a.health > b.health ? 1 : 0));
  return candidates;
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
      const { skip } = await checkStaleness(db, config, "hot");
      if (skip) {
        await sleep(config.liquidationIdleMs);
        continue;
      }

      const candidates = await scanLiquidationCandidates(db, config);
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
  const nowUnix = BigInt(Math.floor(Date.now() / 1000));

  const [allPositions, allMarkets, prices, vault, protoCfg] = await Promise.all([
    getAllPositions(db),
    getMarkets(db),
    getLatestPrices(db),
    getVaultState(db),
    getProtocolConfig(db),
  ]);

  const ticks = buildTicks(
    allMarkets,
    prices,
    toVaultLiquidity(vault),
    toBorrowRateConfig(protoCfg),
    toBigInt(protoCfg?.last_unpause_time),
    nowUnix,
  );

  // Step 1: Update stale indices. Indices have no per-(trader, symbol) dedup
  // key — the executor's sim gate rejects redundant updates cheaply.
  for (const market of allMarkets) {
    if (vault?.is_paused) break;
    const lastUpdate = toBigInt(market.last_index_update);
    const elapsed = nowUnix - lastUpdate;
    if (elapsed > BigInt(config.indexUpdateThresholdSec)) {
      await serialize(() => executor.updateIndices(market.symbol));
    }
  }

  // Step 2: TP/SL order execution.
  const minLifetime = toBigInt(protoCfg?.min_position_lifetime);
  for (const pos of allPositions) {
    const tp = toBigInt(pos.take_profit);
    const sl = toBigInt(pos.stop_loss);
    if (tp === 0n && sl === 0n) continue;

    const tick = ticks.get(pos.symbol);
    if (!tick) continue;

    const age = nowUnix - toBigInt(pos.last_increased_time);
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
  if (vault && protoCfg) {
    const totalAssets = toBigInt(vault.total_assets);
    if (totalAssets > 0n) {
      const netPnl = toBigInt(vault.net_global_trader_pnl);
      const reserved = toBigInt(vault.reserved_usdc);
      const adlPnlBps = BigInt(protoCfg.adl_pnl_bps);
      const adlUtilBps = BigInt(protoCfg.adl_utilization_bps);

      const pnlTrigger = netPnl > 0n && (netPnl * BPS) / totalAssets > adlPnlBps;
      const utilTrigger = (reserved * BPS) / totalAssets > adlUtilBps;

      if (pnlTrigger || utilTrigger) {
        const target = findAdlTarget(allPositions, ticks);
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
      const { skip } = await checkStaleness(db, config, "cold");
      if (!skip) {
        await runColdTick(db, executor, config, dedup, serialize);
      }
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

// -- ADL targeting ----------------------------------------------------------

function findAdlTarget(
  positions: PositionRow[],
  ticks: Map<string, MarketTick>,
): PositionRow | null {
  // Mirrors the BitMEX/Bybit/dYdX ADL ranking: profitable positions are
  // ordered by `unrealizedPnl × leverage`, where leverage = size / collateral.
  // High-leverage winners deleverage before low-leverage whales who happen
  // to be up.
  let best: PositionRow | null = null;
  let bestScore = 0n;

  for (const pos of positions) {
    const tick = ticks.get(pos.symbol);
    if (!tick) continue;

    const collateral = toBigInt(pos.collateral);
    if (collateral === 0n) continue;

    const { pnl } = tick.evaluate(toPositionState(pos));
    if (pnl <= 0n) continue;

    const score = (pnl * toBigInt(pos.size)) / collateral;
    if (score > bestScore) {
      bestScore = score;
      best = pos;
    }
  }

  return best;
}
