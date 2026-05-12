import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  type QueryRunner,
  markets,
  vaultState,
  oraclePrices,
  trades,
} from "@stellars/db";
import type { Subscribable } from "./broadcaster.js";
import { streamFromChannel } from "./sse-stream.js";

/**
 * SSE endpoints. Each route is a thin projector over `streamFromChannel`:
 *   - choose a channel key (which types the payload),
 *   - optionally filter notifications synchronously (e.g. by symbol),
 *   - turn a notification's payload into an SSE event (or return null to skip).
 *
 * The queue / onAbort / finally-unsub plumbing lives in `streamFromChannel`,
 * not here. Event IDs are `<channel>:<row id>` so future Last-Event-ID
 * resumption is trivial. Today we don't replay — clients get only events
 * that happen after they connect.
 */
export function buildSseRoutes(db: QueryRunner, br: Subscribable): Hono {
  const r = new Hono();

  r.get("/prices", (c) =>
    streamFromChannel(c, br, {
      channelKey: "oraclePrices",
      async project(payload) {
        const id = payload?.id;
        if (id == null) return null;
        const rows = await db
          .select()
          .from(oraclePrices)
          .where(eq(oraclePrices.id, id))
          .limit(1);
        if (rows.length === 0) return null;
        return { event: "price", id: `prices:${id}`, data: rows[0] };
      },
    }),
  );

  r.get("/markets/:symbol", (c) => {
    const symbol = c.req.param("symbol");
    return streamFromChannel(c, br, {
      channelKey: "markets",
      filter: (payload) => payload?.symbol === symbol,
      async project() {
        const rows = await db.select().from(markets).where(eq(markets.symbol, symbol)).limit(1);
        if (rows.length === 0) return null;
        return {
          event: "market",
          id: `market:${symbol}:${rows[0].updated_at_ledger}`,
          data: rows[0],
        };
      },
    });
  });

  r.get("/trades/:symbol", (c) => {
    const symbol = c.req.param("symbol");
    return streamFromChannel(c, br, {
      channelKey: "trades",
      filter: (payload) => payload?.symbol === symbol,
      async project(payload) {
        const id = payload?.id;
        if (id == null) return null;
        const rows = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
        if (rows.length === 0) return null;
        return { event: "trade", id: `trade:${id}`, data: rows[0] };
      },
    });
  });

  r.get("/positions", (c) =>
    streamFromChannel(c, br, {
      channelKey: "positions",
      // For DELETE we only have OLD info; payload already carries everything
      // we need. No db round-trip and no filter — the consumer decides if it
      // cares about the trader/symbol on the client side.
      async project(payload) {
        return {
          event: "position",
          id: `position:${payload?.id ?? "?"}`,
          data: payload,
        };
      },
    }),
  );

  r.get("/vault", (c) =>
    streamFromChannel(c, br, {
      channelKey: "vaultState",
      async project() {
        const rows = await db.select().from(vaultState).where(eq(vaultState.id, 1)).limit(1);
        if (rows.length === 0) return null;
        return {
          event: "vault",
          id: `vault:${rows[0].updated_at_ledger}`,
          data: rows[0],
        };
      },
    }),
  );

  return r;
}
