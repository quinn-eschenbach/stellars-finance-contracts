import type { Db } from "@stellars/db";
import type { Executor } from "./executor.js";
import type { KeeperConfig } from "./config.js";
import { TtlDedup } from "./dedup.js";
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
  type PositionRow,
  type MarketRow,
} from "./scanner.js";

const dedup = new TtlDedup();
const DEDUP_TTL_MS = 60_000;

function posKey(trader: string, symbol: string): string {
  return `${trader}:${symbol}`;
}

export async function runTick(db: Db, executor: Executor, config: KeeperConfig): Promise<void> {
  const nowUnix = BigInt(Math.floor(Date.now() / 1000));

  // Load shared data once
  const [allPositions, allMarkets, prices, vault, protoCfg] = await Promise.all([
    getAllPositions(db),
    getMarkets(db),
    getLatestPrices(db),
    getVaultState(db),
    getProtocolConfig(db),
  ]);

  const marketBySymbol = new Map<string, MarketRow>();
  for (const m of allMarkets) {
    marketBySymbol.set(m.symbol, m);
  }

  // Step 1: Update stale indices
  for (const market of allMarkets) {
    const lastUpdate = toBigInt(market.last_index_update);
    const elapsed = nowUnix - lastUpdate;
    if (elapsed > BigInt(config.indexUpdateThresholdSec)) {
      if (vault?.is_paused) continue;
      await executor.updateIndices(market.symbol);
      // Indices have no per-(trader,symbol) dedup key — safe to re-attempt
      // every tick; the executor's sim gate will reject if recently updated.
    }
  }

  // Step 2: Liquidations
  // Over-permissive filter — flag any position whose health falls below a
  // small safety margin (2% of collateral by default). The simulation gate
  // rejects false positives cheaply; false negatives cause bad debt.
  const safetyMarginBps = BigInt(config.liquidationSafetyMarginBps);
  for (const pos of allPositions) {
    const key = posKey(pos.trader, pos.symbol);

    const market = marketBySymbol.get(pos.symbol);
    const markPriceStr = prices.get(pos.symbol);
    if (!market || !markPriceStr) continue;

    const collateral = toBigInt(pos.collateral);
    const safetyMargin = (collateral * safetyMarginBps) / BPS;
    const health = computeHealth(pos, market, markPriceStr);
    if (health >= safetyMargin) continue;

    if (!dedup.claim(key, DEDUP_TTL_MS)) continue;
    const liqOutcome = await executor.liquidatePosition(pos.trader, pos.symbol);
    if (liqOutcome.kind !== "submitted") dedup.release(key);
  }

  // Step 3: TP/SL order execution
  const minLifetime = toBigInt(protoCfg?.min_position_lifetime);
  for (const pos of allPositions) {
    const key = posKey(pos.trader, pos.symbol);

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

    if (!dedup.claim(key, DEDUP_TTL_MS)) continue;
    const orderOutcome = await executor.executeOrder(pos.trader, pos.symbol);
    if (orderOutcome.kind !== "submitted") dedup.release(key);
  }

  // Step 4: ADL check
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
            const adlOutcome = await executor.deleveragePosition(target.trader, target.symbol);
            if (adlOutcome.kind !== "submitted") dedup.release(key);
          }
        }
      }
    }
  }
}

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
