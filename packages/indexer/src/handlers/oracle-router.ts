import { type Db, oraclePrices } from "@stellars/db";
import type { ParsedEvent } from "../parser.js";
import { toNumericString } from "../parser.js";

export async function handleOracleRouterEvent(db: Db, event: ParsedEvent) {
  switch (event.topic0) {
    case "price":
      return handlePrice(db, event);
    case "orccfg":
      break;
    default:
      break;
  }
}

async function handlePrice(db: Db, event: ParsedEvent) {
  const symbol = String(event.topic1);
  const d = event.data as { price: unknown; timestamp: unknown };

  await db.insert(oraclePrices).values({
    ledger: event.ledger,
    timestamp: BigInt(toNumericString(d.timestamp)),
    symbol,
    price: toNumericString(d.price),
  });
}
