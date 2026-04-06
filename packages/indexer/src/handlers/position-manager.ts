import { eq, and } from "drizzle-orm";
import { type Db, positions, markets, trades } from "@stellars/db";
import type { ParsedEvent } from "../parser.js";
import { toNumericString } from "../parser.js";

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
    default:
      break;
  }
}

async function handleIncrease(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const d = event.data as {
    symbol: string; size_delta: unknown; collateral: unknown; entry_price: unknown;
    is_long: boolean; tp: unknown; sl: unknown; new_total_size: unknown; new_total_collateral: unknown;
  };

  const existing = await db
    .select()
    .from(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, d.symbol)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(positions)
      .set({
        size: toNumericString(d.new_total_size),
        collateral: toNumericString(d.new_total_collateral),
        entry_price: toNumericString(d.entry_price),
        is_long: d.is_long,
        take_profit: toNumericString(d.tp),
        stop_loss: toNumericString(d.sl),
        updated_at_ledger: event.ledger,
        updated_at_tx: event.txHash,
        updated_at: new Date(),
      })
      .where(and(eq(positions.trader, trader), eq(positions.symbol, d.symbol)));
  } else {
    await db.insert(positions).values({
      trader,
      symbol: d.symbol,
      collateral: toNumericString(d.new_total_collateral),
      size: toNumericString(d.new_total_size),
      entry_price: toNumericString(d.entry_price),
      entry_borrow_index: "0",
      entry_funding_index: "0",
      is_long: d.is_long,
      last_increased_time: BigInt(0),
      take_profit: toNumericString(d.tp),
      stop_loss: toNumericString(d.sl),
      updated_at_ledger: event.ledger,
      updated_at_tx: event.txHash,
    });
  }

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    trader,
    symbol: d.symbol,
    event_type: "increase",
    size_delta: toNumericString(d.size_delta),
    collateral_delta: toNumericString(d.collateral),
    entry_price: toNumericString(d.entry_price),
    is_long: d.is_long,
  });
}

async function handleDecrease(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const d = event.data as {
    symbol: string; size_delta: unknown; pnl: unknown; borrow_fee: unknown;
    funding_fee: unknown; mark_price: unknown; is_full_close: boolean;
  };

  if (d.is_full_close) {
    await db
      .delete(positions)
      .where(and(eq(positions.trader, trader), eq(positions.symbol, d.symbol)));
  } else {
    const existing = await db
      .select()
      .from(positions)
      .where(and(eq(positions.trader, trader), eq(positions.symbol, d.symbol)))
      .limit(1);
    if (existing.length > 0) {
      const pos = existing[0];
      const oldSize = BigInt(pos.size);
      const delta = BigInt(toNumericString(d.size_delta));
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
        .where(and(eq(positions.trader, trader), eq(positions.symbol, d.symbol)));
    }
  }

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    trader,
    symbol: d.symbol,
    event_type: "decrease",
    size_delta: toNumericString(d.size_delta),
    mark_price: toNumericString(d.mark_price),
    pnl: toNumericString(d.pnl),
    borrow_fee: toNumericString(d.borrow_fee),
    funding_fee: toNumericString(d.funding_fee),
    is_full_close: d.is_full_close,
  });
}

async function handleLiquidation(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const d = event.data as {
    symbol: string; size: unknown; collateral: unknown; pnl: unknown;
    borrow_fee: unknown; funding_fee: unknown; mark_price: unknown; keeper: unknown;
  };

  await db
    .delete(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, d.symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    trader,
    symbol: d.symbol,
    event_type: "liquidation",
    size_delta: toNumericString(d.size),
    collateral_delta: toNumericString(d.collateral),
    mark_price: toNumericString(d.mark_price),
    pnl: toNumericString(d.pnl),
    borrow_fee: toNumericString(d.borrow_fee),
    funding_fee: toNumericString(d.funding_fee),
    is_full_close: true,
    keeper: String(d.keeper),
  });
}

async function handleExecuteOrder(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const d = event.data as {
    symbol: string; size: unknown; pnl: unknown; mark_price: unknown;
    is_tp: boolean; keeper: unknown;
  };

  await db
    .delete(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, d.symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    trader,
    symbol: d.symbol,
    event_type: "order",
    size_delta: toNumericString(d.size),
    mark_price: toNumericString(d.mark_price),
    pnl: toNumericString(d.pnl),
    is_full_close: true,
    is_tp: d.is_tp,
    keeper: String(d.keeper),
  });
}

async function handleAdl(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const d = event.data as { symbol: string; size: unknown; pnl: unknown; mark_price: unknown };

  await db
    .delete(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, d.symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    trader,
    symbol: d.symbol,
    event_type: "adl",
    size_delta: toNumericString(d.size),
    mark_price: toNumericString(d.mark_price),
    pnl: toNumericString(d.pnl),
    is_full_close: true,
  });
}

async function handleIndices(db: Db, event: ParsedEvent) {
  const symbol = String(event.topic1);
  const d = event.data as { acc_borrow_index: unknown; acc_funding_index: unknown; timestamp: unknown };

  await db
    .insert(markets)
    .values({
      symbol,
      acc_borrow_index: toNumericString(d.acc_borrow_index),
      acc_funding_index: toNumericString(d.acc_funding_index),
      last_index_update: BigInt(toNumericString(d.timestamp)),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: markets.symbol,
      set: {
        acc_borrow_index: toNumericString(d.acc_borrow_index),
        acc_funding_index: toNumericString(d.acc_funding_index),
        last_index_update: BigInt(toNumericString(d.timestamp)),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleTpSl(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const d = event.data as { symbol: string; take_profit: unknown; stop_loss: unknown };

  await db
    .update(positions)
    .set({
      take_profit: toNumericString(d.take_profit),
      stop_loss: toNumericString(d.stop_loss),
      updated_at_ledger: event.ledger,
      updated_at_tx: event.txHash,
      updated_at: new Date(),
    })
    .where(and(eq(positions.trader, trader), eq(positions.symbol, d.symbol)));
}

async function handleMaxLeverage(db: Db, event: ParsedEvent) {
  const symbol = String(event.topic1);
  const d = event.data as { max_leverage: unknown };

  await db
    .insert(markets)
    .values({
      symbol,
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
