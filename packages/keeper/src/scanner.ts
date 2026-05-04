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
  MarketTick,
  type BorrowRateConfig,
  type MarketState,
  type PositionState,
  type VaultLiquidity,
} from "@stellars/protocol-math";

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

function toBigInt(value: string | null | undefined): bigint {
  if (value == null || value === "") return 0n;
  return BigInt(value);
}

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

export function toPositionState(p: PositionRow): PositionState {
  return {
    is_long: p.is_long,
    size: toBigInt(p.size),
    collateral: toBigInt(p.collateral),
    entry_price: toBigInt(p.entry_price),
    entry_borrow_index: toBigInt(p.entry_borrow_index),
    entry_funding_index: toBigInt(p.entry_funding_index),
  };
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

async function latestPriceMap(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ symbol: latestOraclePrices.symbol, price: latestOraclePrices.price })
    .from(latestOraclePrices);
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.symbol, row.price);
  return map;
}
