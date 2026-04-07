import { type Db, oraclePrices, oracleConfigEvents } from "@stellars/db";
import type { ParsedEvent } from "../spec-parser.js";
import { toNumericString, unixSeconds } from "../spec-parser.js";

export async function handleOracleRouterEvent(db: Db, event: ParsedEvent) {
  switch (event.topic0) {
    case "price":
      return handlePrice(db, event);
    case "orccfg":
      return handleOracleConfig(db, event);
    default:
      break;
  }
}

async function handlePrice(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db.insert(oraclePrices).values({
    ledger: event.ledger,
    timestamp: toNumericString(data.timestamp),
    symbol: String(data.symbol),
    price: toNumericString(data.price),
  });
}

async function handleOracleConfig(db: Db, event: ParsedEvent) {
  const { data } = event;
  await db.insert(oracleConfigEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    staleness: toNumericString(data.staleness),
    deviation: toNumericString(data.deviation),
    cache_duration: toNumericString(data.cache_duration),
  });
}
