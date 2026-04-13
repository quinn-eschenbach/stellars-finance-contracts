import { eq, and, sql } from "drizzle-orm";
import { type Db, positions, markets, trades, pauseEvents } from "@stellars/db";
import type { ParsedEvent } from "../spec-parser.js";
import { toNumericString, unixSeconds } from "../spec-parser.js";

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
  const { data } = event;
  const trader = String(data.trader);

  const existing = await db
    .select()
    .from(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, data.symbol)))
    .limit(1);

  const ts = unixSeconds(event.timestamp);
  if (existing.length > 0) {
    await db
      .update(positions)
      .set({
        size: toNumericString(data.new_total_size),
        collateral: toNumericString(data.new_total_collateral),
        entry_price: toNumericString(data.entry_price),
        is_long: data.is_long,
        take_profit: toNumericString(data.tp),
        stop_loss: toNumericString(data.sl),
        last_increased_time: ts,
        updated_at_ledger: event.ledger,
        updated_at_tx: event.txHash,
        updated_at: new Date(),
      })
      .where(and(eq(positions.trader, trader), eq(positions.symbol, data.symbol)));
  } else {
    await db.insert(positions).values({
      trader,
      symbol: data.symbol,
      collateral: toNumericString(data.new_total_collateral),
      size: toNumericString(data.new_total_size),
      entry_price: toNumericString(data.entry_price),
      entry_borrow_index: data.entry_borrow_index != null ? toNumericString(data.entry_borrow_index) : "0",
      entry_funding_index: data.entry_funding_index != null ? toNumericString(data.entry_funding_index) : "0",
      is_long: data.is_long,
      last_increased_time: data.last_increased_time != null ? toNumericString(data.last_increased_time) : ts,
      take_profit: toNumericString(data.tp),
      stop_loss: toNumericString(data.sl),
      updated_at_ledger: event.ledger,
      updated_at_tx: event.txHash,
    });
  }

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: ts,
    trader,
    symbol: data.symbol,
    event_type: "increase",
    size_delta: toNumericString(data.size_delta),
    collateral_delta: toNumericString(data.collateral),
    entry_price: toNumericString(data.entry_price),
    is_long: data.is_long,
  });
  await refreshMarketAggregates(db, data.symbol, event.ledger);
}

async function handleDecrease(db: Db, event: ParsedEvent) {
  const { data } = event;
  const trader = String(data.trader);

  if (data.is_full_close) {
    await db
      .delete(positions)
      .where(and(eq(positions.trader, trader), eq(positions.symbol, data.symbol)));
  } else {
    const existing = await db
      .select()
      .from(positions)
      .where(and(eq(positions.trader, trader), eq(positions.symbol, data.symbol)))
      .limit(1);
    if (existing.length > 0) {
      const pos = existing[0];
      const oldSize = BigInt(pos.size);
      const delta = BigInt(toNumericString(data.size_delta));
      const newSize = oldSize - delta;
      const newCollateral = oldSize > 0n
        ? (BigInt(pos.collateral) * newSize) / oldSize
        : 0n;
      await db
        .update(positions)
        .set({
          size: String(newSize),
          collateral: String(newCollateral),
          updated_at_ledger: event.ledger,
          updated_at_tx: event.txHash,
          updated_at: new Date(),
        })
        .where(and(eq(positions.trader, trader), eq(positions.symbol, data.symbol)));
    }
  }

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    trader,
    symbol: data.symbol,
    event_type: "decrease",
    size_delta: toNumericString(data.size_delta),
    mark_price: toNumericString(data.mark_price),
    pnl: toNumericString(data.pnl),
    borrow_fee: toNumericString(data.borrow_fee),
    funding_fee: toNumericString(data.funding_fee),
    is_full_close: data.is_full_close,
  });
  await refreshMarketAggregates(db, data.symbol, event.ledger);
}

async function handleLiquidation(db: Db, event: ParsedEvent) {
  const { data } = event;
  const trader = String(data.trader);

  await db
    .delete(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, data.symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    trader,
    symbol: data.symbol,
    event_type: "liquidation",
    size_delta: toNumericString(data.size),
    collateral_delta: toNumericString(data.collateral),
    mark_price: toNumericString(data.mark_price),
    pnl: toNumericString(data.pnl),
    borrow_fee: toNumericString(data.borrow_fee),
    funding_fee: toNumericString(data.funding_fee),
    is_full_close: true,
    keeper: String(data.keeper),
  });
  await refreshMarketAggregates(db, data.symbol, event.ledger);
}

async function handleExecuteOrder(db: Db, event: ParsedEvent) {
  const { data } = event;
  const trader = String(data.trader);

  await db
    .delete(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, data.symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    trader,
    symbol: data.symbol,
    event_type: "order",
    size_delta: toNumericString(data.size),
    mark_price: toNumericString(data.mark_price),
    pnl: toNumericString(data.pnl),
    is_full_close: true,
    is_tp: data.is_tp,
    keeper: String(data.keeper),
  });
  await refreshMarketAggregates(db, data.symbol, event.ledger);
}

async function handleAdl(db: Db, event: ParsedEvent) {
  const { data } = event;
  const trader = String(data.trader);

  await db
    .delete(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, data.symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    trader,
    symbol: data.symbol,
    event_type: "adl",
    size_delta: toNumericString(data.size),
    mark_price: toNumericString(data.mark_price),
    pnl: toNumericString(data.pnl),
    is_full_close: true,
  });
  await refreshMarketAggregates(db, data.symbol, event.ledger);
}

async function handleIndices(db: Db, event: ParsedEvent) {
  const { data } = event;
  const symbol = String(data.symbol);

  await db
    .insert(markets)
    .values({
      symbol,
      acc_borrow_index: toNumericString(data.acc_borrow_index),
      acc_funding_index: toNumericString(data.acc_funding_index),
      last_index_update: toNumericString(data.timestamp),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: markets.symbol,
      set: {
        acc_borrow_index: toNumericString(data.acc_borrow_index),
        acc_funding_index: toNumericString(data.acc_funding_index),
        last_index_update: toNumericString(data.timestamp),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleTpSl(db: Db, event: ParsedEvent) {
  const { data } = event;
  const trader = String(data.trader);

  await db
    .update(positions)
    .set({
      take_profit: toNumericString(data.take_profit),
      stop_loss: toNumericString(data.stop_loss),
      updated_at_ledger: event.ledger,
      updated_at_tx: event.txHash,
      updated_at: new Date(),
    })
    .where(and(eq(positions.trader, trader), eq(positions.symbol, data.symbol)));
}

async function handleMaxLeverage(db: Db, event: ParsedEvent) {
  const { data } = event;
  const symbol = String(data.symbol);

  await db
    .insert(markets)
    .values({
      symbol,
      max_leverage: toNumericString(data.max_leverage),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: markets.symbol,
      set: {
        max_leverage: toNumericString(data.max_leverage),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleMarketPnl(db: Db, event: ParsedEvent) {
  const { data } = event;
  const symbol = String(data.symbol);
  await db
    .insert(markets)
    .values({
      symbol,
      market_unrealized_pnl: toNumericString(data.unrealized_pnl),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: markets.symbol,
      set: {
        market_unrealized_pnl: toNumericString(data.unrealized_pnl),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handlePause(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db.insert(pauseEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    contract: "position_manager",
    is_paused: data.is_paused,
    caller: String(data.caller),
  });
}
