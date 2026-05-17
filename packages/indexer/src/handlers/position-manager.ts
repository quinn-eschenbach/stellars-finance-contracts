import { eq, and, sql } from "drizzle-orm";
import { type Db, positions, markets, trades, pauseEvents, protocolConfig } from "@stellars/db";
import type { ParsedEvent } from "../spec-parser.js";
import { toNumericString, unixSeconds } from "../convert.js";

// Per-event data shapes. Field names mirror the #[contractevent] structs in
// contracts/position-manager/src/events.rs.

interface IncreasePositionData {
  trader: string;
  symbol: string;
  size_delta: bigint;
  collateral: bigint;
  entry_price: bigint;
  is_long: boolean;
  tp: bigint;
  sl: bigint;
  new_total_size: bigint;
  new_total_collateral: bigint;
  entry_borrow_index: bigint;
  entry_funding_index: bigint;
  last_increased_time: bigint;
}

interface DecreasePositionData {
  trader: string;
  symbol: string;
  size_delta: bigint;
  pnl: bigint;
  borrow_fee: bigint;
  funding_fee: bigint;
  mark_price: bigint;
  is_full_close: boolean;
  /** Absolute post-decrease size + collateral so the indexer can set
   *  positions table values directly without arithmetic deltas. */
  new_total_size: bigint;
  new_total_collateral: bigint;
}

interface LiquidateData {
  trader: string;
  symbol: string;
  size: bigint;
  collateral: bigint;
  pnl: bigint;
  borrow_fee: bigint;
  funding_fee: bigint;
  mark_price: bigint;
  executor: string;
}

interface ExecuteOrderData {
  trader: string;
  symbol: string;
  size: bigint;
  pnl: bigint;
  mark_price: bigint;
  is_tp: boolean;
  executor: string;
}

interface AdlData {
  trader: string;
  symbol: string;
  size: bigint;
  pnl: bigint;
  mark_price: bigint;
}

interface UpdateIndicesData {
  symbol: string;
  acc_borrow_index: bigint;
  acc_funding_index: bigint;
  timestamp: bigint;
}

interface SetTpSlData {
  trader: string;
  symbol: string;
  take_profit: bigint;
  stop_loss: bigint;
}

interface SetMaxLeverageData {
  symbol: string;
  max_leverage: bigint;
}

interface MarketPnlUpdateData {
  symbol: string;
  unrealized_pnl: bigint;
}

interface PauseData {
  is_paused: boolean;
  caller: string;
}

async function refreshMarketAggregates(db: Db, symbol: string, ledger: number) {
  const result = await db.execute<{
    long_oi: string;
    short_oi: string;
    long_avg: string;
    short_avg: string;
  }>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN is_long = true THEN size::numeric ELSE 0 END), 0) AS long_oi,
      COALESCE(SUM(CASE WHEN is_long = false THEN size::numeric ELSE 0 END), 0) AS short_oi,
      CASE
        WHEN COALESCE(SUM(CASE WHEN is_long = true THEN size::numeric ELSE 0 END), 0) > 0
        THEN TRUNC(SUM(CASE WHEN is_long = true THEN size::numeric * entry_price::numeric ELSE 0 END)
             / SUM(CASE WHEN is_long = true THEN size::numeric ELSE 0 END))
        ELSE 0
      END AS long_avg,
      CASE
        WHEN COALESCE(SUM(CASE WHEN is_long = false THEN size::numeric ELSE 0 END), 0) > 0
        THEN TRUNC(SUM(CASE WHEN is_long = false THEN size::numeric * entry_price::numeric ELSE 0 END)
             / SUM(CASE WHEN is_long = false THEN size::numeric ELSE 0 END))
        ELSE 0
      END AS short_avg
    FROM ${positions}
    WHERE ${positions.symbol} = ${symbol}
  `);
  const row = result.rows[0] ?? { long_oi: "0", short_oi: "0", long_avg: "0", short_avg: "0" };
  await db
    .insert(markets)
    .values({
      symbol,
      long_open_interest: String(row.long_oi),
      short_open_interest: String(row.short_oi),
      global_long_avg_price: String(row.long_avg),
      global_short_avg_price: String(row.short_avg),
      updated_at_ledger: ledger,
    })
    .onConflictDoUpdate({
      target: markets.symbol,
      set: {
        long_open_interest: String(row.long_oi),
        short_open_interest: String(row.short_oi),
        global_long_avg_price: String(row.long_avg),
        global_short_avg_price: String(row.short_avg),
        updated_at_ledger: ledger,
        updated_at: new Date(),
      },
    });
}

export async function handlePositionManagerEvent(db: Db, event: ParsedEvent) {
  switch (event.topic0) {
    case "increase":
      return handleIncrease(db, event);
    case "decrease":
      return handleDecrease(db, event);
    case "liq":
      return handleLiquidation(db, event);
    case "exec_ord":
      return handleExecuteOrder(db, event);
    case "adl":
      return handleAdl(db, event);
    case "indices":
      return handleIndices(db, event);
    case "tp_sl":
      return handleTpSl(db, event);
    case "max_lev":
      return handleMaxLeverage(db, event);
    case "mkt_pnl":
      return handleMarketPnl(db, event);
    case "pause":
      return handlePause(db, event);
    default:
      break;
  }
}

async function handleIncrease(db: Db, event: ParsedEvent) {
  const d = event.data as IncreasePositionData;

  const existing = await db
    .select()
    .from(positions)
    .where(and(eq(positions.trader, d.trader), eq(positions.symbol, d.symbol)))
    .limit(1);

  const ts = unixSeconds(event.timestamp);
  if (existing.length > 0) {
    // PM recomputes a weighted-average entry index when adding to an existing
    // Position and emits the new values on every IncreasePosition; persist
    // them so off-chain fee accrual stays aligned with the on-chain
    // accumulator scale.
    await db
      .update(positions)
      .set({
        size: toNumericString(d.new_total_size),
        collateral: toNumericString(d.new_total_collateral),
        entry_price: toNumericString(d.entry_price),
        entry_borrow_index: toNumericString(d.entry_borrow_index),
        entry_funding_index: toNumericString(d.entry_funding_index),
        is_long: d.is_long,
        take_profit: toNumericString(d.tp),
        stop_loss: toNumericString(d.sl),
        last_increased_time: ts,
        updated_at_ledger: event.ledger,
        updated_at_tx: event.txHash,
        updated_at: new Date(),
      })
      .where(and(eq(positions.trader, d.trader), eq(positions.symbol, d.symbol)));
  } else {
    await db.insert(positions).values({
      trader: d.trader,
      symbol: d.symbol,
      collateral: toNumericString(d.new_total_collateral),
      size: toNumericString(d.new_total_size),
      entry_price: toNumericString(d.entry_price),
      entry_borrow_index: d.entry_borrow_index != null ? toNumericString(d.entry_borrow_index) : "0",
      entry_funding_index: d.entry_funding_index != null ? toNumericString(d.entry_funding_index) : "0",
      is_long: d.is_long,
      last_increased_time: d.last_increased_time != null ? toNumericString(d.last_increased_time) : ts,
      take_profit: toNumericString(d.tp),
      stop_loss: toNumericString(d.sl),
      updated_at_ledger: event.ledger,
      updated_at_tx: event.txHash,
    });
  }

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: ts,
    trader: d.trader,
    symbol: d.symbol,
    event_type: "increase",
    size_delta: toNumericString(d.size_delta),
    collateral_delta: toNumericString(d.collateral),
    entry_price: toNumericString(d.entry_price),
    is_long: d.is_long,
  });
  await refreshMarketAggregates(db, d.symbol, event.ledger);
}

async function handleDecrease(db: Db, event: ParsedEvent) {
  const d = event.data as DecreasePositionData;

  if (d.is_full_close) {
    await db
      .delete(positions)
      .where(and(eq(positions.trader, d.trader), eq(positions.symbol, d.symbol)));
  } else {
    // Write absolute values from the event payload instead of re-deriving
    // via (oldSize - delta) + proportional-collateral math. The contract
    // has already done that calculation; we just persist its result, which
    // makes a replay set the same row twice rather than double-debit.
    const newSize = toNumericString(d.new_total_size);
    const newCollateral = toNumericString(d.new_total_collateral);
    await db
      .update(positions)
      .set({
        size: newSize,
        collateral: newCollateral,
        updated_at_ledger: event.ledger,
        updated_at_tx: event.txHash,
        updated_at: new Date(),
      })
      .where(and(eq(positions.trader, d.trader), eq(positions.symbol, d.symbol)));
  }

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    trader: d.trader,
    symbol: d.symbol,
    event_type: "decrease",
    size_delta: toNumericString(d.size_delta),
    mark_price: toNumericString(d.mark_price),
    pnl: toNumericString(d.pnl),
    borrow_fee: toNumericString(d.borrow_fee),
    funding_fee: toNumericString(d.funding_fee),
    is_full_close: d.is_full_close,
  });
  await refreshMarketAggregates(db, d.symbol, event.ledger);
}

async function handleLiquidation(db: Db, event: ParsedEvent) {
  const d = event.data as LiquidateData;

  await db
    .delete(positions)
    .where(and(eq(positions.trader, d.trader), eq(positions.symbol, d.symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    trader: d.trader,
    symbol: d.symbol,
    event_type: "liquidation",
    size_delta: toNumericString(d.size),
    collateral_delta: toNumericString(d.collateral),
    mark_price: toNumericString(d.mark_price),
    pnl: toNumericString(d.pnl),
    borrow_fee: toNumericString(d.borrow_fee),
    funding_fee: toNumericString(d.funding_fee),
    is_full_close: true,
    executor: d.executor,
  });
  await refreshMarketAggregates(db, d.symbol, event.ledger);
}

async function handleExecuteOrder(db: Db, event: ParsedEvent) {
  const d = event.data as ExecuteOrderData;

  await db
    .delete(positions)
    .where(and(eq(positions.trader, d.trader), eq(positions.symbol, d.symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    trader: d.trader,
    symbol: d.symbol,
    event_type: "order",
    size_delta: toNumericString(d.size),
    mark_price: toNumericString(d.mark_price),
    pnl: toNumericString(d.pnl),
    is_full_close: true,
    is_tp: d.is_tp,
    executor: d.executor,
  });
  await refreshMarketAggregates(db, d.symbol, event.ledger);
}

async function handleAdl(db: Db, event: ParsedEvent) {
  const d = event.data as AdlData;

  await db
    .delete(positions)
    .where(and(eq(positions.trader, d.trader), eq(positions.symbol, d.symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    trader: d.trader,
    symbol: d.symbol,
    event_type: "adl",
    size_delta: toNumericString(d.size),
    mark_price: toNumericString(d.mark_price),
    pnl: toNumericString(d.pnl),
    is_full_close: true,
  });
  await refreshMarketAggregates(db, d.symbol, event.ledger);
}

async function handleIndices(db: Db, event: ParsedEvent) {
  const d = event.data as UpdateIndicesData;

  await db
    .insert(markets)
    .values({
      symbol: d.symbol,
      acc_borrow_index: toNumericString(d.acc_borrow_index),
      acc_funding_index: toNumericString(d.acc_funding_index),
      last_index_update: toNumericString(d.timestamp),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: markets.symbol,
      set: {
        acc_borrow_index: toNumericString(d.acc_borrow_index),
        acc_funding_index: toNumericString(d.acc_funding_index),
        last_index_update: toNumericString(d.timestamp),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleTpSl(db: Db, event: ParsedEvent) {
  const d = event.data as SetTpSlData;

  await db
    .update(positions)
    .set({
      take_profit: toNumericString(d.take_profit),
      stop_loss: toNumericString(d.stop_loss),
      updated_at_ledger: event.ledger,
      updated_at_tx: event.txHash,
      updated_at: new Date(),
    })
    .where(and(eq(positions.trader, d.trader), eq(positions.symbol, d.symbol)));
}

async function handleMaxLeverage(db: Db, event: ParsedEvent) {
  const d = event.data as SetMaxLeverageData;

  await db
    .insert(markets)
    .values({
      symbol: d.symbol,
      max_leverage: toNumericString(d.max_leverage),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: markets.symbol,
      set: {
        max_leverage: toNumericString(d.max_leverage),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleMarketPnl(db: Db, event: ParsedEvent) {
  const d = event.data as MarketPnlUpdateData;
  await db
    .insert(markets)
    .values({
      symbol: d.symbol,
      market_unrealized_pnl: toNumericString(d.unrealized_pnl),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: markets.symbol,
      set: {
        market_unrealized_pnl: toNumericString(d.unrealized_pnl),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handlePause(db: Db, event: ParsedEvent) {
  const d = event.data as PauseData;
  const ts = unixSeconds(event.timestamp);
  await db.insert(pauseEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: ts,
    contract: "position_manager",
    is_paused: d.is_paused,
    caller: d.caller,
  });

  // Mirror PositionManager's on-chain LastUnpauseTime so off-chain MarketTick
  // projection can clamp `effective_start = max(last_index_update, last_unpause_time)`.
  // Insert with id=1 so the upsert hits the singleton row (matches getProtocolConfig).
  if (!d.is_paused) {
    await db
      .insert(protocolConfig)
      .values({ id: 1, last_unpause_time: ts, updated_at_ledger: event.ledger })
      .onConflictDoUpdate({
        target: protocolConfig.id,
        set: {
          last_unpause_time: ts,
          updated_at_ledger: event.ledger,
          updated_at: new Date(),
        },
      });
  }
}
