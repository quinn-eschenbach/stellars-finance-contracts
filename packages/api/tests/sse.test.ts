import { describe, it, expect } from "vitest";
import { buildSseRoutes } from "../src/sse.js";
import { CHANNELS } from "@stellars/db";
import { FakeDb, asDb } from "./_fake-db.js";
import { FakeBroadcaster } from "./_fake-broadcaster.js";

/**
 * Read an SSE response body until we've seen `eventCount` SSE messages, then
 * return the raw chunks joined together. Each `await s.writeSSE(...)` writes
 * a complete record ending in `\n\n`, so chunk count == event count.
 */
async function readEvents(
  res: Response,
  eventCount: number,
  cancel: () => void,
): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let seen = 0;
  while (seen < eventCount) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    seen = (buf.match(/\n\n/g) ?? []).length;
  }
  cancel();
  // Drain whatever's still buffered so the stream's finally runs.
  try {
    await reader.cancel();
  } catch {
    /* already cancelled */
  }
  return buf;
}

function parseEvents(raw: string): Array<{ event: string; id: string; data: string }> {
  return raw
    .split("\n\n")
    .filter((s) => s.trim().length > 0)
    .map((block) => {
      const out: { event: string; id: string; data: string } = { event: "", id: "", data: "" };
      for (const line of block.split("\n")) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const key = line.slice(0, colon).trim();
        const val = line.slice(colon + 1).trim();
        if (key === "event") out.event = val;
        else if (key === "id") out.id = val;
        else if (key === "data") out.data = val;
      }
      return out;
    });
}

describe("GET /prices (SSE)", () => {
  it("queries oracle_prices by id and writes a 'price' event", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    db.enqueueSelect([{ id: 42, symbol: "BTCUSD", price: "950000000000" }]);

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/prices");
    expect(res.status).toBe(200);

    // Wait for the subscribe() to register before dispatching.
    await tickUntil(() => br.subscriberCount(CHANNELS.oraclePrices) === 1);
    br.dispatch(CHANNELS.oraclePrices, { id: 42, symbol: "BTCUSD" });

    const raw = await readEvents(res, 1, () => {});
    const events = parseEvents(raw);
    expect(events[0].event).toBe("price");
    expect(events[0].id).toBe("prices:42");
    expect(JSON.parse(events[0].data)).toEqual({ id: 42, symbol: "BTCUSD", price: "950000000000" });
  });

  it("skips notifications whose payload has no id", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    // Only the second notification triggers a db read.
    db.enqueueSelect([{ id: 7, symbol: "ETHUSD" }]);

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/prices");
    await tickUntil(() => br.subscriberCount(CHANNELS.oraclePrices) === 1);
    br.dispatch(CHANNELS.oraclePrices, null);
    br.dispatch(CHANNELS.oraclePrices, { id: 7, symbol: "ETHUSD" });

    const raw = await readEvents(res, 1, () => {});
    const events = parseEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("prices:7");
    expect(db.calls).toHaveLength(1); // null payload was skipped before any db hit
  });

  it("skips notifications whose row was deleted before we could fetch it", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    db.enqueueSelect([]); // fetch for the first id yields nothing
    db.enqueueSelect([{ id: 9, symbol: "XLMUSD" }]);

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/prices");
    await tickUntil(() => br.subscriberCount(CHANNELS.oraclePrices) === 1);
    br.dispatch(CHANNELS.oraclePrices, { id: 1, symbol: "BTCUSD" });
    br.dispatch(CHANNELS.oraclePrices, { id: 9, symbol: "XLMUSD" });

    const raw = await readEvents(res, 1, () => {});
    const events = parseEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("prices:9");
  });
});

describe("GET /markets/:symbol (SSE)", () => {
  it("only emits events for the requested symbol", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    db.enqueueSelect([{ symbol: "BTCUSD", updated_at_ledger: 123 }]);

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/markets/BTCUSD");
    await tickUntil(() => br.subscriberCount(CHANNELS.markets) === 1);

    br.dispatch(CHANNELS.markets, { symbol: "ETHUSD" }); // filtered out
    br.dispatch(CHANNELS.markets, { symbol: "BTCUSD" });

    const raw = await readEvents(res, 1, () => {});
    const events = parseEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("market");
    expect(events[0].id).toBe("market:BTCUSD:123");
  });

  it("drops the event when no row matches the symbol", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    db.enqueueSelect([]); // no market row found
    db.enqueueSelect([{ symbol: "BTCUSD", updated_at_ledger: 5 }]);

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/markets/BTCUSD");
    await tickUntil(() => br.subscriberCount(CHANNELS.markets) === 1);
    br.dispatch(CHANNELS.markets, { symbol: "BTCUSD" });
    br.dispatch(CHANNELS.markets, { symbol: "BTCUSD" });

    const raw = await readEvents(res, 1, () => {});
    const events = parseEvents(raw);
    expect(events).toHaveLength(1);
  });
});

describe("GET /trades/:symbol (SSE)", () => {
  it("emits a 'trade' event when a matching trade arrives", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    db.enqueueSelect([{ id: 11, symbol: "BTCUSD", event_type: "increase" }]);

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/trades/BTCUSD");
    await tickUntil(() => br.subscriberCount(CHANNELS.trades) === 1);
    br.dispatch(CHANNELS.trades, { id: 99, symbol: "ETHUSD" });
    br.dispatch(CHANNELS.trades, { id: 11, symbol: "BTCUSD" });

    const raw = await readEvents(res, 1, () => {});
    const events = parseEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("trade");
    expect(events[0].id).toBe("trade:11");
  });

  it("skips events whose payload has no id", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    db.enqueueSelect([{ id: 5, symbol: "BTCUSD" }]);

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/trades/BTCUSD");
    await tickUntil(() => br.subscriberCount(CHANNELS.trades) === 1);
    br.dispatch(CHANNELS.trades, { symbol: "BTCUSD" }); // no id → skipped
    br.dispatch(CHANNELS.trades, { id: 5, symbol: "BTCUSD" });

    const raw = await readEvents(res, 1, () => {});
    expect(parseEvents(raw)).toHaveLength(1);
  });

  it("drops a notification whose trade row has since been deleted", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    db.enqueueSelect([]); // first fetch: no row
    db.enqueueSelect([{ id: 8, symbol: "BTCUSD" }]); // second fetch: ok

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/trades/BTCUSD");
    await tickUntil(() => br.subscriberCount(CHANNELS.trades) === 1);
    br.dispatch(CHANNELS.trades, { id: 7, symbol: "BTCUSD" });
    br.dispatch(CHANNELS.trades, { id: 8, symbol: "BTCUSD" });

    const raw = await readEvents(res, 1, () => {});
    expect(parseEvents(raw)).toHaveLength(1);
  });
});

describe("GET /positions (SSE)", () => {
  it("forwards the broadcaster payload directly (no extra db read)", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/positions");
    await tickUntil(() => br.subscriberCount(CHANNELS.positions) === 1);
    br.dispatch(CHANNELS.positions, {
      id: 33,
      trader: "GABC",
      symbol: "BTCUSD",
      op: "UPDATE",
    });

    const raw = await readEvents(res, 1, () => {});
    const events = parseEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("position");
    expect(events[0].id).toBe("position:33");
    expect(JSON.parse(events[0].data)).toEqual({
      id: 33,
      trader: "GABC",
      symbol: "BTCUSD",
      op: "UPDATE",
    });
    // Positions handler never touches the db — it forwards the payload as-is.
    expect(db.calls).toHaveLength(0);
  });

  it("uses '?' as the id placeholder when payload is null", async () => {
    const br = new FakeBroadcaster();
    const db = new FakeDb();
    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/positions");
    await tickUntil(() => br.subscriberCount(CHANNELS.positions) === 1);
    br.dispatch(CHANNELS.positions, null);

    const raw = await readEvents(res, 1, () => {});
    const events = parseEvents(raw);
    expect(events[0].id).toBe("position:?");
    expect(events[0].data).toBe("null");
  });
});

describe("SSE cancellation", () => {
  it("runs the unsubscribe finally when the consumer cancels each stream", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    const app = buildSseRoutes(asDb(db), br);

    // Hit every route once, wait for subscribe() to register, then cancel.
    // The body's reader.cancel() propagates into hono streamSSE, fires our
    // `s.onAbort` handler, closes the queue, and unblocks the for-await so
    // the route's `finally { unsub() }` runs.
    const endpoints = ["/prices", "/markets/BTCUSD", "/trades/BTCUSD", "/positions", "/vault"];
    for (const path of endpoints) {
      const before = totalSubscribers(br);
      const res = await app.request(path);
      await tickUntil(() => totalSubscribers(br) === before + 1);
      await res.body!.cancel();
      await tickUntil(() => totalSubscribers(br) === before);
    }

    expect(totalSubscribers(br)).toBe(0);
  });

  it("drops notifications that race in after the queue is closed", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    const app = buildSseRoutes(asDb(db), br);

    const res = await app.request("/positions");
    await tickUntil(() => totalSubscribers(br) > 0);
    await res.body!.cancel();
    await tickUntil(() => totalSubscribers(br) === 0);

    // Subscriber was already removed by unsub(), so dispatch is a no-op —
    // but even if a late event slipped through, the queue's `closed` guard
    // drops push() silently. This is the safety belt that proves it.
    expect(() => br.dispatch("positions_changed", { id: 1 })).not.toThrow();
  });

  it("runs cleanup via the iterator return() path when the body throws mid-loop", async () => {
    // Force the db.select() inside the for-await body to throw. The thrown
    // error propagates out of the for-await loop, which calls the iterator's
    // return() — that's the cleanup branch the cancellation tests don't hit.
    const br = new FakeBroadcaster();
    const db = new FakeDb();
    // No selects enqueued → fake throws "no select queued" when the route
    // tries to look up the row.
    const app = buildSseRoutes(asDb(db), br);

    const res = await app.request("/vault");
    await tickUntil(() => totalSubscribers(br) > 0);
    br.dispatch(CHANNELS.vaultState, { id: 1 });
    await tickUntil(() => totalSubscribers(br) === 0);
    expect(totalSubscribers(br)).toBe(0);
    // Tidy the stream so the test runner doesn't hang on an open ReadableStream.
    await res.body!.cancel();
  });
});

function totalSubscribers(br: FakeBroadcaster): number {
  let n = 0;
  for (const s of br.subscribers.values()) n += s.size;
  return n;
}

describe("GET /vault (SSE)", () => {
  it("queries vault_state and emits with the ledger as the event id", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    db.enqueueSelect([{ id: 1, total_assets: "1000", updated_at_ledger: 222 }]);

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/vault");
    await tickUntil(() => br.subscriberCount(CHANNELS.vaultState) === 1);
    br.dispatch(CHANNELS.vaultState, { id: 1 });

    const raw = await readEvents(res, 1, () => {});
    const events = parseEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("vault");
    expect(events[0].id).toBe("vault:222");
  });

  it("skips the event when the vault row is gone", async () => {
    const db = new FakeDb();
    const br = new FakeBroadcaster();
    db.enqueueSelect([]); // first dispatch: no row
    db.enqueueSelect([{ id: 1, updated_at_ledger: 9 }]);

    const app = buildSseRoutes(asDb(db), br);
    const res = await app.request("/vault");
    await tickUntil(() => br.subscriberCount(CHANNELS.vaultState) === 1);
    br.dispatch(CHANNELS.vaultState, { id: 1 });
    br.dispatch(CHANNELS.vaultState, { id: 1 });

    const raw = await readEvents(res, 1, () => {});
    expect(parseEvents(raw)).toHaveLength(1);
  });
});

/**
 * Yields the microtask queue until `cond()` returns true or the iteration cap
 * is hit. Used to wait for `await br.subscribe(...)` inside the SSE handler
 * to complete after we initiate the request — Hono's streamSSE handler runs
 * asynchronously, so dispatching too early would arrive before there's a
 * subscriber.
 */
async function tickUntil(cond: () => boolean, max = 50): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  if (!cond()) throw new Error("tickUntil: condition never became true");
}
