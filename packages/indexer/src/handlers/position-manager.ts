import { eq, and } from "drizzle-orm";
import { type Db, positions, markets, trades } from "@stellars/db";
import type { ParsedEvent } from "../parser.js";

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
  const [symbol, sizeDelta, collateral, entryPrice, isLong, tp, sl, newTotalSize, newTotalCollateral] = event.data as [
    string, bigint, bigint, bigint, boolean, bigint, bigint, bigint, bigint,
  ];

  // Upsert the position
  const existing = await db
    .select()
    .from(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, symbol)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(positions)
      .set({
        size: String(newTotalSize),
        collateral: String(newTotalCollateral),
        entry_price: String(entryPrice),
        is_long: isLong,
        take_profit: String(tp),
        stop_loss: String(sl),
        updated_at_ledger: event.ledger,
        updated_at_tx: event.txHash,
        updated_at: new Date(),
      })
      .where(and(eq(positions.trader, trader), eq(positions.symbol, symbol)));
  } else {
    await db.insert(positions).values({
      trader,
      symbol,
      collateral: String(newTotalCollateral),
      size: String(newTotalSize),
      entry_price: String(entryPrice),
      entry_borrow_index: "0",
      entry_funding_index: "0",
      is_long: isLong,
      last_increased_time: BigInt(0),
      take_profit: String(tp),
      stop_loss: String(sl),
      updated_at_ledger: event.ledger,
      updated_at_tx: event.txHash,
    });
  }

  // Insert trade record
  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    trader,
    symbol,
    event_type: "increase",
    size_delta: String(sizeDelta),
    collateral_delta: String(collateral),
    entry_price: String(entryPrice),
    is_long: isLong,
  });
}

async function handleDecrease(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const [symbol, sizeDelta, pnl, borrowFee, fundingFee, markPrice, isFullClose] = event.data as [
    string, bigint, bigint, bigint, bigint, bigint, boolean,
  ];

  if (isFullClose) {
    await db
      .delete(positions)
      .where(and(eq(positions.trader, trader), eq(positions.symbol, symbol)));
  } else {
    // Partial close: decrement size proportionally
    const existing = await db
      .select()
      .from(positions)
      .where(and(eq(positions.trader, trader), eq(positions.symbol, symbol)))
      .limit(1);
    if (existing.length > 0) {
      const pos = existing[0];
      const oldSize = BigInt(pos.size);
      const delta = BigInt(sizeDelta);
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
        .where(and(eq(positions.trader, trader), eq(positions.symbol, symbol)));
    }
  }

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    trader,
    symbol,
    event_type: "decrease",
    size_delta: String(sizeDelta),
    mark_price: String(markPrice),
    pnl: String(pnl),
    borrow_fee: String(borrowFee),
    funding_fee: String(fundingFee),
    is_full_close: isFullClose,
  });
}

async function handleLiquidation(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const [symbol, size, collateral, pnl, borrowFee, fundingFee, markPrice, keeper] = event.data as [
    string, bigint, bigint, bigint, bigint, bigint, bigint, string,
  ];

  await db
    .delete(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    trader,
    symbol,
    event_type: "liquidation",
    size_delta: String(size),
    collateral_delta: String(collateral),
    mark_price: String(markPrice),
    pnl: String(pnl),
    borrow_fee: String(borrowFee),
    funding_fee: String(fundingFee),
    is_full_close: true,
    keeper: String(keeper),
  });
}

async function handleExecuteOrder(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const [symbol, size, pnl, markPrice, isTp, keeper] = event.data as [
    string, bigint, bigint, bigint, boolean, string,
  ];

  await db
    .delete(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    trader,
    symbol,
    event_type: "order",
    size_delta: String(size),
    mark_price: String(markPrice),
    pnl: String(pnl),
    is_full_close: true,
    is_tp: isTp,
    keeper: String(keeper),
  });
}

async function handleAdl(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const [symbol, size, pnl, markPrice] = event.data as [string, bigint, bigint, bigint];

  await db
    .delete(positions)
    .where(and(eq(positions.trader, trader), eq(positions.symbol, symbol)));

  await db.insert(trades).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: BigInt(Date.parse(event.timestamp) / 1000),
    trader,
    symbol,
    event_type: "adl",
    size_delta: String(size),
    mark_price: String(markPrice),
    pnl: String(pnl),
    is_full_close: true,
  });
}

async function handleIndices(db: Db, event: ParsedEvent) {
  const symbol = String(event.topic1);
  const [accBorrowIndex, accFundingIndex, timestamp] = event.data as [bigint, bigint, bigint];

  await db
    .insert(markets)
    .values({
      symbol,
      acc_borrow_index: String(accBorrowIndex),
      acc_funding_index: String(accFundingIndex),
      last_index_update: BigInt(timestamp),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: markets.symbol,
      set: {
        acc_borrow_index: String(accBorrowIndex),
        acc_funding_index: String(accFundingIndex),
        last_index_update: BigInt(timestamp),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}

async function handleTpSl(db: Db, event: ParsedEvent) {
  const trader = String(event.topic1);
  const [symbol, takeProfit, stopLoss] = event.data as [string, bigint, bigint];

  await db
    .update(positions)
    .set({
      take_profit: String(takeProfit),
      stop_loss: String(stopLoss),
      updated_at_ledger: event.ledger,
      updated_at_tx: event.txHash,
      updated_at: new Date(),
    })
    .where(and(eq(positions.trader, trader), eq(positions.symbol, symbol)));
}

async function handleMaxLeverage(db: Db, event: ParsedEvent) {
  const symbol = String(event.topic1);
  const maxLeverage = event.data[0] as bigint;

  await db
    .insert(markets)
    .values({
      symbol,
      max_leverage: String(maxLeverage),
      updated_at_ledger: event.ledger,
    })
    .onConflictDoUpdate({
      target: markets.symbol,
      set: {
        max_leverage: String(maxLeverage),
        updated_at_ledger: event.ledger,
        updated_at: new Date(),
      },
    });
}
