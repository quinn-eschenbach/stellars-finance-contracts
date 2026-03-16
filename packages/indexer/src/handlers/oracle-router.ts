import { type Db, oraclePrices } from "@stellars/db";
import type { ParsedEvent } from "../parser.js";

export async function handleOracleRouterEvent(db: Db, event: ParsedEvent) {
  switch (event.topic0) {
    case "price":
      return handlePrice(db, event);
    case "orccfg":
      // Config changes are informational — protocol_config table doesn't store oracle config
      break;
    default:
      break;
  }
}

async function handlePrice(db: Db, event: ParsedEvent) {
  const symbol = String(event.topic1);
  const [price, timestamp] = event.data as [bigint, bigint];

  await db.insert(oraclePrices).values({
    ledger: event.ledger,
    timestamp: BigInt(timestamp),
    symbol,
    price: String(price),
  });
}
