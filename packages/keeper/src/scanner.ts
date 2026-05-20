import { eq } from "drizzle-orm";
import {
  positions,
  markets,
  vaultState,
  protocolConfig,
  latestOraclePrices,
  indexerCursor,
  type Db,
} from "@stellars/db";
import {
  BPS,
  MarketTick,
  toBigInt,
  toBorrowRateConfig,
  toMarketState,
  toPositionState,
  toVaultLiquidity,
} from "@stellars/protocol-math";
import type { KeeperConfig } from "./config.js";

export { toPositionState };

export type PositionRow = typeof positions.$inferSelect;
export type MarketRow = typeof markets.$inferSelect;
export type VaultStateRow = typeof vaultState.$inferSelect;
export type ProtocolConfigRow = typeof protocolConfig.$inferSelect;
export type IndexerCursorRow = typeof indexerCursor.$inferSelect;

/**
 * Everything a keeper iteration needs to decide what to do, materialised once
 * per tick. Includes raw rows where loop logic still wants them (positions,
 * markets, vault, protocol config, cursor) plus pre-projected MarketTicks
 * keyed by symbol — built via `MarketTick.project` so off-chain `evaluate`
 * matches what the contract's `MarketTick::refresh` would produce right now.
 */
export interface KeeperWorld {
  now: bigint;
  positions: PositionRow[];
  markets: MarketRow[];
  ticks: Map<string, MarketTick>;
  vault: VaultStateRow | undefined;
  protocolConfig: ProtocolConfigRow | undefined;
  cursor: IndexerCursorRow | undefined;
  /** Indexer lag in seconds; Infinity if cursor row missing or never recorded. */
  indexerLagSec: number;
}

function indexerLagSec(cursor: IndexerCursorRow | undefined, now: bigint): number {
  if (!cursor) return Number.POSITIVE_INFINITY;
  const closeTime = Number(cursor.last_ledger_close_time);
  if (!closeTime) return Number.POSITIVE_INFINITY;
  return Number(now) - closeTime;
}

/**
 * Atomically load every row a keeper iteration needs and project ticks for
 * each market that has a current price. Markets without a current price are
 * absent from the `ticks` map; loop code treats `ticks.get(symbol) === undefined`
 * the same as it treats a missing position.
 */
export async function loadKeeperWorld(db: Db): Promise<KeeperWorld> {
  const now = BigInt(Math.floor(Date.now() / 1000));

  const [allPositions, allMarkets, prices, vault, protoCfg, cursorRow] =
    await Promise.all([
      db.select().from(positions),
      db.select().from(markets),
      latestPriceMap(db),
      db.select().from(vaultState).where(eq(vaultState.id, 1)).limit(1),
      db.select().from(protocolConfig).where(eq(protocolConfig.id, 1)).limit(1),
      db.select().from(indexerCursor).where(eq(indexerCursor.id, 1)).limit(1),
    ]);

  const vaultRow = vault[0];
  const protoCfgRow = protoCfg[0];
  const cursor = cursorRow[0];

  const vaultLiq = toVaultLiquidity(vaultRow);
  const rateConfig = toBorrowRateConfig(protoCfgRow);
  const lastUnpauseTime = toBigInt(protoCfgRow?.last_unpause_time);

  const ticks = new Map<string, MarketTick>();
  for (const m of allMarkets) {
    const priceStr = prices.get(m.symbol);
    if (!priceStr) continue;
    ticks.set(
      m.symbol,
      MarketTick.project({
        market: toMarketState(m),
        mark_price: toBigInt(priceStr),
        vault: vaultLiq,
        rate_config: rateConfig,
        now,
        last_unpause_time: lastUnpauseTime,
      }),
    );
  }

  return {
    now,
    positions: allPositions,
    markets: allMarkets,
    ticks,
    vault: vaultRow,
    protocolConfig: protoCfgRow,
    cursor,
    indexerLagSec: indexerLagSec(cursor, now),
  };
}

// -- Decision math against the KeeperWorld ----------------------------------
//
// These functions are the testable kernel: given a snapshot of the world,
// what action does the keeper take? They depend on nothing but the KeeperWorld
// and KeeperConfig, so they can be exercised against a hand-built world
// without any executor / dedup / serialize scaffolding.

export interface LiquidationCandidate {
  pos: PositionRow;
  health: bigint;
}

/**
 * Positions whose effective_health (post zero-sum funding cap + protocol
 * funding cut, mirroring the on-chain gate) has dropped below the
 * `liquidation_threshold_bps` of their collateral. Ranked worst-health-first
 * so cascades drain the most-underwater positions before less-stressed ones.
 *
 * Falls back to `config.liquidationSafetyMarginBps` for the threshold when the
 * indexer hasn't yet mirrored `protocolConfig`. The fallback for `funding_cut_bps`
 * is zero — undercounting the trader's effective funding payments is
 * conservative (we'd liquidate later, not earlier, than the contract).
 */
export function scanLiquidationCandidates(
  world: KeeperWorld,
  config: KeeperConfig,
): LiquidationCandidate[] {
  const thresholdBps = BigInt(
    world.protocolConfig?.liquidation_threshold_bps ?? config.liquidationSafetyMarginBps,
  );
  const fundingCutBps = BigInt(world.protocolConfig?.funding_cut_bps ?? 0);

  const candidates: LiquidationCandidate[] = [];
  for (const pos of world.positions) {
    const tick = world.ticks.get(pos.symbol);
    if (!tick) continue;

    const collateral = toBigInt(pos.collateral);
    const threshold = (collateral * thresholdBps) / BPS;
    const { effective_health } = tick.evaluate(toPositionState(pos), undefined, fundingCutBps);
    if (effective_health >= threshold) continue;

    candidates.push({ pos, health: effective_health });
  }

  candidates.sort((a, b) => (a.health < b.health ? -1 : a.health > b.health ? 1 : 0));
  return candidates;
}

/**
 * BitMEX/Bybit/dYdX-style ADL ranking: among profitable positions, pick the
 * one with the highest `unrealizedPnl × leverage` score, where leverage =
 * size / collateral. High-leverage winners deleverage before low-leverage
 * whales who happen to be up.
 *
 * Returns `null` when no open position is profitable on its current tick.
 */
export function findAdlTarget(world: KeeperWorld): PositionRow | null {
  let best: PositionRow | null = null;
  let bestScore = 0n;

  for (const pos of world.positions) {
    const tick = world.ticks.get(pos.symbol);
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

async function latestPriceMap(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ symbol: latestOraclePrices.symbol, price: latestOraclePrices.price })
    .from(latestOraclePrices);
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.symbol, row.price);
  return map;
}
