import type { Db } from "@stellars/db";
import type { Executor } from "./executor.js";
import type { KeeperConfig } from "./config.js";
import type { TtlDedup } from "./dedup.js";
import type { Serialize } from "./serializer.js";
import {
  toBigInt,
  calcUnrealizedPnl,
  calcBorrowFee,
  calcFundingFee,
  calcHealth,
  isTpTriggered,
  isSlTriggered,
  BPS,
} from "./math.js";
import {
  getAllPositions,
  getMarkets,
  getLatestPrices,
  getVaultState,
  getProtocolConfig,
  getIndexerCursor,
  type PositionRow,
  type MarketRow,
} from "./scanner.js";

export const DEDUP_TTL_MS = 60_000;

export function posKey(trader: string, symbol: string): string {
  return `${trader}:${symbol}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// -- Liquidation candidate scanning ------------------------------------------

interface LiquidationCandidate {
  pos: PositionRow;
  health: bigint;
}

async function scanLiquidationCandidates(
  db: Db,
  config: KeeperConfig,
): Promise<LiquidationCandidate[]> {
  const [allPositions, allMarkets, prices] = await Promise.all([
    getAllPositions(db),
    getMarkets(db),
    getLatestPrices(db),
  ]);

  const marketBySymbol = new Map<string, MarketRow>();
  for (const m of allMarkets) marketBySymbol.set(m.symbol, m);

  const safetyMarginBps = BigInt(config.liquidationSafetyMarginBps);
  const candidates: LiquidationCandidate[] = [];
  for (const pos of allPositions) {
    const market = marketBySymbol.get(pos.symbol);
    const markPriceStr = prices.get(pos.symbol);
    if (!market || !markPriceStr) continue;

    const collateral = toBigInt(pos.collateral);
    const safetyMargin = (collateral * safetyMarginBps) / BPS;
    const health = computeHealth(pos, market, markPriceStr);
    if (health >= safetyMargin) continue;

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

  const marketBySymbol = new Map<string, MarketRow>();
  for (const m of allMarkets) marketBySymbol.set(m.symbol, m);

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

    const markPriceStr = prices.get(pos.symbol);
    if (!markPriceStr) continue;
    const markPrice = toBigInt(markPriceStr);

    const age = nowUnix - toBigInt(pos.last_increased_time);
    if (age < minLifetime) continue;

    const triggered =
      isTpTriggered(tp, markPrice, pos.is_long) ||
      isSlTriggered(sl, markPrice, pos.is_long);
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
        const target = findAdlTarget(allPositions, marketBySymbol, prices);
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

// -- Math helpers -----------------------------------------------------------

function computeHealth(pos: PositionRow, market: MarketRow, markPriceStr: string): bigint {
  const size = toBigInt(pos.size);
  const entryPrice = toBigInt(pos.entry_price);
  const markPrice = toBigInt(markPriceStr);
  const collateral = toBigInt(pos.collateral);

  const pnl = calcUnrealizedPnl(size, entryPrice, markPrice, pos.is_long);
  const borrow = calcBorrowFee(size, toBigInt(pos.entry_borrow_index), toBigInt(market.acc_borrow_index));
  const funding = calcFundingFee(size, toBigInt(pos.entry_funding_index), toBigInt(market.acc_funding_index), pos.is_long);

  return calcHealth(collateral, pnl, borrow, funding);
}

function findAdlTarget(
  positions: PositionRow[],
  marketBySymbol: Map<string, MarketRow>,
  prices: Map<string, string>,
): PositionRow | null {
  // Mirrors the BitMEX/Bybit/dYdX ADL ranking: profitable positions are
  // ordered by `unrealizedPnl × leverage`, where leverage = size / collateral.
  // High-leverage winners deleverage before low-leverage whales who happen
  // to be up.
  let best: PositionRow | null = null;
  let bestScore = 0n;

  for (const pos of positions) {
    const market = marketBySymbol.get(pos.symbol);
    const markPriceStr = prices.get(pos.symbol);
    if (!market || !markPriceStr) continue;

    const collateral = toBigInt(pos.collateral);
    if (collateral === 0n) continue;

    const pnl = calcUnrealizedPnl(
      toBigInt(pos.size),
      toBigInt(pos.entry_price),
      toBigInt(markPriceStr),
      pos.is_long,
    );
    if (pnl <= 0n) continue;

    const score = (pnl * toBigInt(pos.size)) / collateral;
    if (score > bestScore) {
      bestScore = score;
      best = pos;
    }
  }

  return best;
}
