import { type Db, oraclePrices, oracleConfigEvents } from "@stellars/db";
import type { ParsedEvent } from "../spec-parser.js";
import { toNumericString, unixSeconds } from "../convert.js";

// Per-event data shapes. Cast `event.data` at the top of each handler so the
// rest of the function gets typed field access. Field names mirror the
// #[contractevent] structs in contracts/oracle-router/src/events.rs.

interface PriceFetchData {
  symbol: string;
  price: bigint;
  timestamp: bigint;
}

interface OracleConfigUpdateData {
  staleness: bigint;
  deviation: bigint;
  min_required_sources: number;
}

interface OracleSourcesUpdateData {
  symbol: string;
  sources: string[];
}

export async function handleOracleRouterEvent(db: Db, event: ParsedEvent) {
  switch (event.topic0) {
    case "price":
      return handlePrice(db, event);
    case "orccfg":
      return handleOracleConfig(db, event);
    case "orcsrc":
      return handleOracleSources(db, event);
    default:
      break;
  }
}

async function handlePrice(db: Db, event: ParsedEvent) {
  const d = event.data as PriceFetchData;
  await db.insert(oraclePrices).values({
    ledger: event.ledger,
    timestamp: toNumericString(d.timestamp),
    symbol: d.symbol,
    price: toNumericString(d.price),
  });
}

async function handleOracleConfig(db: Db, event: ParsedEvent) {
  const d = event.data as OracleConfigUpdateData;
  await db.insert(oracleConfigEvents).values({
    tx_hash: event.txHash,
    ledger: event.ledger,
    timestamp: unixSeconds(event.timestamp),
    staleness: toNumericString(d.staleness),
    deviation: toNumericString(d.deviation),
    min_required_sources: d.min_required_sources,
  });
}

/**
 * OracleSourcesUpdate fires every time the admin rotates a symbol's source
 * list. Off-chain monitoring should pick up these events to detect
 * unauthorised rotations. For now we just log — a dedicated
 * `oracle_source_events` table can be added if richer querying is needed.
 */
async function handleOracleSources(_db: Db, event: ParsedEvent) {
  const d = event.data as OracleSourcesUpdateData;
  console.log(
    `[oracle-router] OracleSourcesUpdate ledger=${event.ledger} symbol=${d.symbol} sources=[${d.sources.join(",")}]`,
  );
}
