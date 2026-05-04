import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq } from "drizzle-orm";
import {
  type Db,
  CHANNELS,
  markets,
  vaultState,
  oraclePrices,
  trades,
  type ChannelPayloads,
} from "@stellars/db";
import type { Broadcaster, Notification } from "./broadcaster.js";

/**
 * SSE endpoints. Each handler:
 *   1. Subscribes to a Postgres NOTIFY channel via the Broadcaster.
 *   2. On each notification, queries the full row(s) and writes an SSE event.
 *   3. On client disconnect, unsubscribes.
 *
 * Event IDs are `<channel>:<row id>` so future Last-Event-ID resumption is
 * trivial. Today we don't replay — clients get only events that happen
 * after they connect.
 */
export function buildSseRoutes(db: Db, br: Broadcaster): Hono {
  const r = new Hono();

  r.get("/prices", (c) =>
    streamSSE(c, async (s) => {
      const queue = makeQueue<Notification>();
      const unsub = await br.subscribe(CHANNELS.oraclePrices, (n) => queue.push(n));
      try {
        for await (const n of queue) {
          const id = (n.payload as ChannelPayloads["oraclePrices"] | null)?.id;
          if (id == null) continue;
          const rows = await db.select().from(oraclePrices).where(eq(oraclePrices.id, id)).limit(1);
          if (rows.length === 0) continue;
          await s.writeSSE({ event: "price", id: `prices:${id}`, data: JSON.stringify(rows[0]) });
        }
      } finally {
        unsub();
      }
    }),
  );

  r.get("/markets/:symbol", (c) =>
    streamSSE(c, async (s) => {
      const symbol = c.req.param("symbol");
      const queue = makeQueue<Notification>();
      const unsub = await br.subscribe(CHANNELS.markets, (n) => {
        if ((n.payload as ChannelPayloads["markets"] | null)?.symbol === symbol) queue.push(n);
      });
      try {
        for await (const _ of queue) {
          const rows = await db.select().from(markets).where(eq(markets.symbol, symbol)).limit(1);
          if (rows.length === 0) continue;
          await s.writeSSE({
            event: "market",
            id: `market:${symbol}:${rows[0].updated_at_ledger}`,
            data: JSON.stringify(rows[0]),
          });
        }
      } finally {
        unsub();
      }
    }),
  );

  r.get("/trades/:symbol", (c) =>
    streamSSE(c, async (s) => {
      const symbol = c.req.param("symbol");
      const queue = makeQueue<Notification>();
      const unsub = await br.subscribe(CHANNELS.trades, (n) => {
        if ((n.payload as ChannelPayloads["trades"] | null)?.symbol === symbol) queue.push(n);
      });
      try {
        for await (const n of queue) {
          const id = (n.payload as ChannelPayloads["trades"] | null)?.id;
          if (id == null) continue;
          const rows = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
          if (rows.length === 0) continue;
          await s.writeSSE({ event: "trade", id: `trade:${id}`, data: JSON.stringify(rows[0]) });
        }
      } finally {
        unsub();
      }
    }),
  );

  r.get("/positions", (c) =>
    streamSSE(c, async (s) => {
      const queue = makeQueue<Notification>();
      const unsub = await br.subscribe(CHANNELS.positions, (n) => queue.push(n));
      try {
        for await (const n of queue) {
          // For DELETE we only have OLD info; payload already contains it.
          const payload = n.payload as ChannelPayloads["positions"] | null;
          await s.writeSSE({
            event: "position",
            id: `position:${payload?.id ?? "?"}`,
            data: JSON.stringify(n.payload),
          });
        }
      } finally {
        unsub();
      }
    }),
  );

  r.get("/vault", (c) =>
    streamSSE(c, async (s) => {
      const queue = makeQueue<Notification>();
      const unsub = await br.subscribe(CHANNELS.vaultState, (n) => queue.push(n));
      try {
        for await (const _ of queue) {
          const rows = await db.select().from(vaultState).where(eq(vaultState.id, 1)).limit(1);
          if (rows.length === 0) continue;
          await s.writeSSE({
            event: "vault",
            id: `vault:${rows[0].updated_at_ledger}`,
            data: JSON.stringify(rows[0]),
          });
        }
      } finally {
        unsub();
      }
    }),
  );

  return r;
}

/**
 * Tiny single-producer/single-consumer async queue. Lets push() be sync
 * (called from broadcaster's notification listener) while the SSE handler
 * iterates with `for await`.
 */
function makeQueue<T>(): AsyncIterable<T> & { push: (v: T) => void } {
  const buf: T[] = [];
  const waiters: Array<(v: IteratorResult<T>) => void> = [];
  let closed = false;
  const push = (v: T) => {
    if (waiters.length > 0) {
      waiters.shift()!({ value: v, done: false });
    } else {
      buf.push(v);
    }
  };
  const iter: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (buf.length > 0) {
            return Promise.resolve({ value: buf.shift()!, done: false });
          }
          if (closed) return Promise.resolve({ value: undefined as never, done: true });
          return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve));
        },
        return() {
          closed = true;
          while (waiters.length > 0) {
            waiters.shift()!({ value: undefined as never, done: true });
          }
          return Promise.resolve({ value: undefined as never, done: true });
        },
      };
    },
  };
  return Object.assign(iter, { push });
}
